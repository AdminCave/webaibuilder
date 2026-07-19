/**
 * Remote kill-switch store (PLAN §3 rule 3, M4) — main process.
 *
 * Purpose: be able to disable a subscription backend path overnight, WITHOUT a release.
 *
 * Design (fail-safe, in this order):
 *   1. Bundled default (all subscription backends active, shared/backends.ts).
 *   2. Overridden by a remote JSON from a configurable URL.
 *   3. The last successfully loaded remote config is cached to `<userData>`
 *      (with a TTL). Network error → last cache → bundled default.
 *   4. A structurally broken remote/cache config is IGNORED
 *      (coerceKillSwitchConfig → null), never partially applied.
 *
 * The fetch NEVER blocks app startup (refreshInBackground = fire-and-forget)
 * and sends NO user data (a plain GET, no body, no query, no credentials).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  coerceKillSwitchConfig,
  resolveKillSwitch,
  type KillSwitchConfig,
} from '../shared/backends';

/** Fetches and parses the remote config. Injectable for tests. Throws on errors. */
export type KillSwitchFetch = (url: string) => Promise<unknown>;

/** Default fetch via the global `fetch` (Node ≥18). No user data. */
const defaultFetch: KillSwitchFetch = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as unknown;
};

export interface KillSwitchStoreOptions {
  /** Cache file under `<userData>` (e.g. backends-cache.json). */
  cacheFilePath: string;
  /** Remote URL of `backends.json` (AdminCave-hosted). If absent, no fetch. */
  remoteUrl?: string;
  /** Cache lifetime in ms (default: 60 minutes). */
  ttlMs?: number;
  /** Fetch implementation (default: the global fetch). */
  fetchConfig?: KillSwitchFetch;
  /** Time source in ms (default: Date.now). */
  now?: () => number;
}

interface CacheFile {
  fetchedAt: number;
  config: KillSwitchConfig;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export class KillSwitchStore {
  private readonly cacheFilePath: string;
  private readonly remoteUrl: string | undefined;
  private readonly ttlMs: number;
  private readonly fetchConfig: KillSwitchFetch;
  private readonly now: () => number;

  /** Last successfully loaded, valid remote config (last-known-good). */
  private remote: KillSwitchConfig | null = null;
  private fetchedAt = 0;
  private inflight: Promise<KillSwitchConfig> | null = null;

  constructor(options: KillSwitchStoreOptions) {
    this.cacheFilePath = options.cacheFilePath;
    this.remoteUrl = options.remoteUrl;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchConfig = options.fetchConfig ?? defaultFetch;
    this.now = options.now ?? (() => Date.now());
    this.load();
  }

  /**
   * Effective kill switch RIGHT NOW (synchronous, never throws): the bundled
   * default, overridden by the last-known-good remote config.
   */
  effective(): KillSwitchConfig {
    return resolveKillSwitch(this.remote);
  }

  /** Is the last successful fetch still within the TTL? */
  private isFresh(): boolean {
    return this.remote !== null && this.now() - this.fetchedAt < this.ttlMs;
  }

  /**
   * Updates the remote config. Fail-safe: on a network error or a broken
   * response, the last good state is retained (cache → default). Never throws.
   * Does not run twice (in-flight deduplication).
   */
  refresh(force = false): Promise<KillSwitchConfig> {
    if (this.remoteUrl === undefined) return Promise.resolve(this.effective());
    if (!force && this.isFresh()) return Promise.resolve(this.effective());
    if (this.inflight !== null) return this.inflight;

    const url = this.remoteUrl;
    this.inflight = (async () => {
      try {
        const parsed = await this.fetchConfig(url);
        const config = coerceKillSwitchConfig(parsed);
        if (config !== null) {
          // Valid → adopt as last-known-good and cache it.
          this.remote = config;
          this.fetchedAt = this.now();
          this.persist();
        }
        // Broken (null) → ignore, the old state remains (fail-safe).
      } catch {
        // Network error → the last cache/default remains (fail-safe).
      } finally {
        this.inflight = null;
      }
      return this.effective();
    })();
    return this.inflight;
  }

  /** Fire-and-forget: NEVER blocks app startup (PLAN §3). */
  refreshInBackground(): void {
    void this.refresh().catch(() => undefined);
  }

  /* ---------------- Cache persistence ---------------- */

  private load(): void {
    try {
      if (!existsSync(this.cacheFilePath)) return;
      const parsed = JSON.parse(readFileSync(this.cacheFilePath, 'utf8')) as Partial<CacheFile>;
      const config = coerceKillSwitchConfig(parsed?.config);
      if (config !== null) {
        this.remote = config;
        this.fetchedAt = typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0;
      }
    } catch {
      /* Broken cache → ignore, the bundled default applies. */
    }
  }

  private persist(): void {
    if (this.remote === null) return;
    try {
      mkdirSync(dirname(this.cacheFilePath), { recursive: true });
      const payload: CacheFile = { fetchedAt: this.fetchedAt, config: this.remote };
      writeFileSync(this.cacheFilePath, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* Best effort — the in-memory state remains authoritative. */
    }
  }
}
