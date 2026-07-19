/**
 * Persistence of the AI backend settings in the main process.
 *
 * Secret-free data (backend, provider, model) is stored as JSON at
 * `<userData>/agent-settings.json`. The API key is deliberately NOT written to
 * disk (PLAN §4, Linux plaintext trap) — since M3 it lives in the OS keychain
 * (secrets.ts), or, when no keychain is available, only in memory for the
 * running session. The store holds only the derived `hasApiKey` flag.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  backendDisplayName,
  isSubscriptionBackend,
  subscriptionActivationError,
  type BackendPickerState,
} from '../shared/backends';
import {
  coerceAgentSettings,
  effectiveModel,
  effectiveProvider,
  mergeAgentSettings,
  PROVIDER_ENV_KEYS,
  type AgentSettings,
  type AgentSettingsData,
  type AgentSettingsInput,
} from '../shared/settings';
import type { SecretsService } from './secrets';

export class AgentSettingsStore {
  private data: AgentSettingsData;

  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretsService,
    /**
     * Environment for the env-key fallback (ANTHROPIC_API_KEY & co.). Deliberately
     * defaults to `{}` instead of `process.env`: the composition root (ipc.ts)
     * passes `process.env` through explicitly, tests stay deterministic.
     */
    private readonly env: Readonly<Record<string, string | undefined>> = {},
  ) {
    this.data = this.load();
  }

  private load(): AgentSettingsData {
    try {
      if (existsSync(this.filePath)) {
        return coerceAgentSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
      }
    } catch {
      /* Corrupt file → defaults, don't crash. */
    }
    return coerceAgentSettings(undefined);
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      // Only the secret-free fields — never the API key (coerceAgentSettings
      // ensures `this.data` carries no foreign fields).
      writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
    } catch {
      /* Best effort — the in-memory state remains authoritative. */
    }
  }

  /**
   * Renderer-ready view: secret-free plus derived flags. `hasApiKey` refers to
   * the current backend/provider — keychain first, otherwise the environment
   * variable (consistency with detection: a claude-sdk "detected" via
   * ANTHROPIC_API_KEY is thereby also usable). `keychainAvailable` reports
   * whether the OS keychain is in use or the in-memory fallback is active.
   */
  get(): AgentSettings {
    // Subscription/CLI backends have no app-managed key — `hasApiKey` must not
    // gate them (login is solely up to the vendor CLI, PLAN §3).
    const subscription = isSubscriptionBackend(this.data.backendId);
    const keychainKey =
      !subscription && this.secrets.hasApiKey(this.data.backendId, this.data.provider);
    const envKey = !subscription && !keychainKey && this.envApiKey() !== undefined;
    const view: AgentSettings = {
      ...this.data,
      hasApiKey: keychainKey || envKey,
      keychainAvailable: this.secrets.keychainAvailable().available,
    };
    if (keychainKey) view.apiKeySource = 'keychain';
    else if (envKey) view.apiKeySource = 'env';
    return view;
  }

  /** Key from the environment (fallback when none is in the keychain). */
  private envApiKey(): string | undefined {
    const name = PROVIDER_ENV_KEYS[effectiveProvider(this.data.backendId, this.data.provider)];
    const value = this.env[name]?.trim();
    return value !== undefined && value !== '' ? value : undefined;
  }

  /**
   * Applies an update. `apiKey`: a string sets it, null (or empty) deletes it,
   * undefined leaves the existing key unchanged. Only the secret-free fields are
   * persisted; the key goes into the keychain. The secret-free fields are merged
   * first so the key is stored under the NEWLY selected backend/provider.
   */
  set(input: AgentSettingsInput): AgentSettings {
    this.data = mergeAgentSettings(this.data, input);
    if (input.apiKey !== undefined) {
      const key = input.apiKey === null ? '' : input.apiKey.trim();
      if (key === '') {
        this.secrets.deleteApiKey(this.data.backendId, this.data.provider);
      } else {
        this.secrets.setApiKey(this.data.backendId, this.data.provider, key);
      }
    }
    this.persist();
    return this.get();
  }

  /**
   * The API key for `createBackend` (main process only), or undefined. Keychain
   * first, otherwise the environment variable (important for `byok`, which
   * throws without an explicit key). For subscription/CLI backends always
   * undefined — they use the vendor CLI's own login and get no key from the app (PLAN §3).
   */
  currentApiKey(): string | undefined {
    if (isSubscriptionBackend(this.data.backendId)) return undefined;
    return this.secrets.getApiKey(this.data.backendId, this.data.provider) ?? this.envApiKey();
  }

  /** The model to use effectively (override or provider default). */
  currentModel(): string {
    return effectiveModel(this.data);
  }

  currentBackendId(): AgentSettingsData['backendId'] {
    return this.data.backendId;
  }
}

/** Only the part of the BackendService that {@link applySettingsUpdate} needs. */
export interface SubscriptionReadinessSource {
  availability(): Promise<BackendPickerState>;
}

/**
 * Applies a settings update while enforcing the AUTHORITATIVE activation check
 * for subscription backends (PLAN §3/§4): if a subscription backend is chosen as
 * the active backend, it must be usable after the same detection + kill switch +
 * acknowledgment that the UI sees — otherwise the update is rejected with an
 * actionable message and NOT persisted. This way `appSession` can never start a
 * CLI that the user cannot use at all. API-key backends pass through unhindered.
 */
export async function applySettingsUpdate(
  store: AgentSettingsStore,
  readiness: SubscriptionReadinessSource,
  input: AgentSettingsInput,
): Promise<AgentSettings> {
  const target = input.backendId;
  if (target !== undefined && isSubscriptionBackend(target)) {
    const state = await readiness.availability();
    const view = state.backends.find((b) => b.backendId === target);
    const message =
      view === undefined
        ? `${backendDisplayName(target)} is not available.`
        : subscriptionActivationError(view);
    if (message !== null) throw new Error(message);
  }
  return store.set(input);
}
