/**
 * AI backend settings (PLAN §4/§6, M2 + M4).
 *
 * The turn-driving backend can be any of the six backends:
 *  - API-key backends: `byok` (Vercel AI SDK, your own API key + provider +
 *    model) and `claude-sdk` (@anthropic-ai/claude-agent-sdk, API key + model).
 *  - Subscription/CLI backends (M4): `claude-cli`, `codex`, `gemini-cli`,
 *    `grok-cli` — they spawn the official vendor CLI that the user installed and
 *    signed into themselves (PLAN §3). They need NO app-managed API key and have
 *    no provider/model concept; model/provider are deliberately left empty.
 *
 * Whether a subscription backend may even be set as the active backend is checked
 * authoritatively by the main process against detection + kill switch +
 * acknowledgment (see main/settingsStore.ts `applySettingsUpdate` and
 * shared/backends.ts).
 *
 * Secret handling (PLAN §4, security): the API key is NOT written to disk in
 * plaintext (the Linux plaintext trap). Since M3 it lives in the OS keychain
 * (@napi-rs/keyring, see main/secrets.ts) — just like the deploy credentials. If
 * no system keychain exists (headless Linux, Sway/Hyprland without a Secret
 * Service), the main process deliberately falls back to a pure in-memory store
 * for the running session and reports this to the UI via `keychainAvailable` (no
 * silent plaintext).
 *
 * Environment-neutral (no node/electron/DOM) — shared by main, preload, and
 * renderer, and headless-testable.
 */

import type { BackendId } from '@webaibuilder/core';

import { isSubscriptionBackend } from './backends';

/**
 * IDs usable as the active (turn-driving) backend — since M4, all six. Whether a
 * subscription backend may actually be set is additionally decided by the main
 * process based on detection (installed/logged in/kill switch/notice).
 */
export type ActiveBackendId = BackendId;

/** Provider for the `byok` adapter (Vercel AI SDK v6). */
export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'xai';

export const ACTIVE_BACKEND_IDS: readonly ActiveBackendId[] = [
  'byok',
  'claude-sdk',
  'claude-cli',
  'codex',
  'gemini-cli',
  'grok-cli',
];
export const BYOK_PROVIDERS: readonly ByokProvider[] = ['anthropic', 'openai', 'google', 'xai'];

/** The persistable, secret-free part of the settings. */
export interface AgentSettingsData {
  backendId: ActiveBackendId;
  /** Only relevant for `byok`. */
  provider: ByokProvider;
  /** Model override; empty = backend default. */
  model: string;
}

/**
 * What the renderer sees: the secret-free data plus derived flags. The key itself
 * is never handed to the renderer.
 *  - `hasApiKey`: is a key available for the current backend/provider (keychain OR
 *    environment variable, see {@link PROVIDER_ENV_KEYS})?
 *  - `apiKeySource`: where the key comes from (only set when `hasApiKey`).
 *  - `keychainAvailable`: is there an OS keychain? If false, the main process
 *    holds secrets only in memory for the session (see the warning below).
 */
export interface AgentSettings extends AgentSettingsData {
  hasApiKey: boolean;
  apiKeySource?: 'keychain' | 'env';
  keychainAvailable: boolean;
}

/**
 * Environment variables from which an API key is read per provider when none is
 * in the keychain. Keeps the unlock consistent with the detection in
 * @webaibuilder/agents (which reports `claude-sdk` as available when
 * ANTHROPIC_API_KEY is set) — previously it read as "detected" but the chat
 * stayed locked.
 */
export const PROVIDER_ENV_KEYS: Record<ByokProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
};

/**
 * Warning shown in the UI when no system keychain was found (PLAN §4, security).
 * No silent plaintext — the user learns that credentials only survive this
 * session.
 */
export const KEYCHAIN_UNAVAILABLE_WARNING =
  'No system keychain found — credentials are kept in memory for this session only.';

/** What the renderer may set. `apiKey`: a string sets it, null clears it, undefined leaves it unchanged. */
export interface AgentSettingsInput {
  backendId?: ActiveBackendId;
  provider?: ByokProvider;
  model?: string;
  apiKey?: string | null;
}

/**
 * Sensible default models. Anthropic paths use Claude Opus 4.8
 * (`claude-opus-4-8`, the current Opus model). For the remaining byok providers
 * the model stays empty — the user enters the model ID, so no possibly outdated
 * third-party ID is hardcoded here.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';

const DEFAULT_BYOK_MODEL: Record<ByokProvider, string> = {
  anthropic: DEFAULT_CLAUDE_MODEL,
  openai: '',
  google: '',
  xai: '',
};

export const DEFAULT_AGENT_SETTINGS: AgentSettingsData = {
  backendId: 'byok',
  provider: 'anthropic',
  model: DEFAULT_CLAUDE_MODEL,
};

function isActiveBackend(value: unknown): value is ActiveBackendId {
  return typeof value === 'string' && (ACTIVE_BACKEND_IDS as readonly string[]).includes(value);
}

function isProvider(value: unknown): value is ByokProvider {
  return typeof value === 'string' && (BYOK_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Merges a (partial) update into a valid, complete record. Invalid values fall
 * back to the existing value. The `model` value is only trimmed; an empty value
 * means "backend default".
 */
export function mergeAgentSettings(
  current: AgentSettingsData,
  patch: AgentSettingsInput,
): AgentSettingsData {
  const backendId = isActiveBackend(patch.backendId) ? patch.backendId : current.backendId;
  const provider = isProvider(patch.provider) ? patch.provider : current.provider;
  const model = patch.model !== undefined ? patch.model.trim() : current.model;
  return { backendId, provider, model };
}

/** Defensively parses an unknown (e.g. disk-read) value. */
export function coerceAgentSettings(value: unknown): AgentSettingsData {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_AGENT_SETTINGS };
  }
  return mergeAgentSettings(DEFAULT_AGENT_SETTINGS, value as AgentSettingsInput);
}

/**
 * The model that effectively goes to `createBackend` (override or provider
 * default). Subscription/CLI backends have no model concept — the vendor CLI
 * decides it itself; here it stays empty (createBackend ignores it for CLI
 * backends).
 */
export function effectiveModel(data: AgentSettingsData): string {
  if (isSubscriptionBackend(data.backendId)) return '';
  if (data.model.trim() !== '') return data.model.trim();
  if (data.backendId === 'claude-sdk') return DEFAULT_CLAUDE_MODEL;
  return DEFAULT_BYOK_MODEL[data.provider];
}

/**
 * The provider under which the API key is stored in the keychain. `claude-sdk`
 * always talks to Anthropic, so it uses the same Anthropic key as `byok` with
 * provider `anthropic` — the key is stored and shared per provider (not per
 * backend). For `byok`, the selected provider applies.
 */
export function effectiveProvider(backendId: ActiveBackendId, provider: ByokProvider): ByokProvider {
  return backendId === 'claude-sdk' ? 'anthropic' : provider;
}
