/**
 * Main-process secrets service backed by the OS keychain
 * (`@napi-rs/keyring`, PLAN §4: no bare `safeStorage` — the Linux plaintext trap).
 *
 * An entry is an `Entry(service, account)`. The `service` is constant
 * ("WebAIBuilder"); the `account` encodes the kind and identity of the secret:
 *
 *   Key naming scheme (M3 — also reused by the deploy engine):
 *     account = `<kind>:<id>`
 *       apikey:<provider>   API key of an AI provider (anthropic | openai | …)
 *       deploy:<targetId>   Credentials of a deploy target (packages/deploy, M3)
 *
 *   A DeployTarget's `credentialRef` (packages/core) points to such an entry;
 *   the deploy UI calls `setSecret('deploy', targetId, …)` for it.
 *
 * Robustness (PLAN §4, security): if an OS keychain is missing (headless
 * Linux, Sway/Hyprland without a Secret Service), the app must NOT crash and
 * writes NO silent plaintext. A self-test at startup detects this; the service
 * then falls back to a pure in-memory store for the running session
 * (`keychainAvailable()` reports this, including the reason, to the UI).
 *
 * Importable only in the main process (native dependency). The plaintext of a
 * secret is never logged and never handed to the renderer.
 */

import { Entry } from '@napi-rs/keyring';

import {
  effectiveProvider,
  type ActiveBackendId,
  type ByokProvider,
} from '../shared/settings';

/** Constant keychain service name. */
export const KEYCHAIN_SERVICE = 'WebAIBuilder';

/** Kind of a secret — determines the `account` prefix. */
export type SecretKind = 'apikey' | 'deploy';

/** Result of the keychain self-test. */
export interface KeychainStatus {
  /** true = OS keychain usable; false = in-memory fallback active. */
  available: boolean;
  /** Technical reason if unavailable (not for end-user copy). */
  reason?: string;
}

/**
 * Minimal synchronous keyring entry — the subset of `@napi-rs/keyring`'s `Entry`
 * that we use. Kept as an interface so tests can inject an entry that
 * deterministically simulates backend failures.
 */
export interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

/** Builds an entry for (service, account). Injectable for tests. */
export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

const defaultEntryFactory: KeyringEntryFactory = (service, account) =>
  new Entry(service, account);

/** account string from kind + id (the documented key naming scheme). */
export function secretAccount(kind: SecretKind, id: string): string {
  return `${kind}:${id}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface SecretsServiceOptions {
  /** Keychain service name (default: "WebAIBuilder"). */
  service?: string;
  /** Entry factory (default: the real `@napi-rs/keyring` `Entry`). */
  entryFactory?: KeyringEntryFactory;
  /**
   * Forces the in-memory fallback without any keychain access. For tests and
   * deliberately headless environments.
   */
  forceFallback?: boolean;
}

/**
 * Secrets under a constant `service` name. Sits either on the real OS keychain
 * or — if it is missing/fails — on an in-memory store behind the same interface.
 * The fallback activates on the self-test or on an unexpected backend error at
 * runtime (fail-safe, never crashes).
 */
export class SecretsService {
  private readonly service: string;
  private readonly entryFactory: KeyringEntryFactory;
  private readonly memory = new Map<string, string>();
  private status: KeychainStatus;

  constructor(options: SecretsServiceOptions = {}) {
    this.service = options.service ?? KEYCHAIN_SERVICE;
    this.entryFactory = options.entryFactory ?? defaultEntryFactory;
    this.status = options.forceFallback === true
      ? { available: false, reason: 'Fallback forced.' }
      : this.probe();
  }

  /** Current keychain status (the renderer only gets `available`). */
  keychainAvailable(): KeychainStatus {
    return { ...this.status };
  }

  /* ---------------- Generic secrets (also for the deploy engine) ---------------- */

  /** Stores a secret. Empty value = delete. */
  setSecret(kind: SecretKind, id: string, value: string): void {
    const account = secretAccount(kind, id);
    if (value === '') {
      this.remove(account);
      return;
    }
    this.write(account, value);
  }

  /** Reads a secret, or null if none is stored. */
  getSecret(kind: SecretKind, id: string): string | null {
    return this.read(secretAccount(kind, id));
  }

  /** Deletes a secret. true if one was removed. */
  deleteSecret(kind: SecretKind, id: string): boolean {
    return this.remove(secretAccount(kind, id));
  }

  /** Is a secret present? (without revealing the value) */
  hasSecret(kind: SecretKind, id: string): boolean {
    const value = this.getSecret(kind, id);
    return value !== null && value !== '';
  }

  /* ---------------- API keys (per provider, shared across backends) ---------------- */

  /** Sets the API key of the effective provider. Empty key = delete. */
  setApiKey(backendId: ActiveBackendId, provider: ByokProvider, key: string): void {
    this.setSecret('apikey', effectiveProvider(backendId, provider), key.trim());
  }

  getApiKey(backendId: ActiveBackendId, provider: ByokProvider): string | null {
    return this.getSecret('apikey', effectiveProvider(backendId, provider));
  }

  deleteApiKey(backendId: ActiveBackendId, provider: ByokProvider): boolean {
    return this.deleteSecret('apikey', effectiveProvider(backendId, provider));
  }

  hasApiKey(backendId: ActiveBackendId, provider: ByokProvider): boolean {
    return this.hasSecret('apikey', effectiveProvider(backendId, provider));
  }

  /* ---------------- Internals: keychain with fail-safe fallback ---------------- */

  /**
   * Self-test: a sentinel entry is written, read, and deleted again (leaves
   * nothing behind). If an operation throws, the keychain is considered
   * unavailable.
   */
  private probe(): KeychainStatus {
    const account = secretAccount('apikey', '__probe__');
    const sentinel = 'wab-keychain-probe';
    try {
      const entry = this.entryFactory(this.service, account);
      entry.setPassword(sentinel);
      const read = entry.getPassword();
      entry.deleteCredential();
      if (read !== sentinel) {
        return { available: false, reason: 'Keychain self-test returned a wrong value.' };
      }
      return { available: true };
    } catch (error) {
      return { available: false, reason: describeError(error) };
    }
  }

  /** Permanently degrades to the in-memory store (fail-safe, no crash). */
  private degrade(error: unknown): void {
    if (this.status.available) {
      this.status = { available: false, reason: describeError(error) };
    }
  }

  private write(account: string, value: string): void {
    if (this.status.available) {
      try {
        this.entryFactory(this.service, account).setPassword(value);
        return;
      } catch (error) {
        this.degrade(error);
      }
    }
    this.memory.set(account, value);
  }

  private read(account: string): string | null {
    if (this.status.available) {
      try {
        return this.entryFactory(this.service, account).getPassword();
      } catch (error) {
        this.degrade(error);
      }
    }
    return this.memory.get(account) ?? null;
  }

  private remove(account: string): boolean {
    if (this.status.available) {
      try {
        return this.entryFactory(this.service, account).deleteCredential();
      } catch (error) {
        // NoEntry is not a backend failure — just "nothing to delete".
        if (isNoEntry(error)) return false;
        this.degrade(error);
      }
    }
    return this.memory.delete(account);
  }
}

/** Detects the keyring's "no entry present" error (not a backend failure). */
function isNoEntry(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return message.includes('no matching entry') || message.includes('no entry');
}

/* ------------------------------------------------------------------ */
/* Singleton per app run.                                             */
/* ------------------------------------------------------------------ */

let instance: SecretsService | null = null;

export function getSecretsService(): SecretsService {
  instance ??= new SecretsService();
  return instance;
}
