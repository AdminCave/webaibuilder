/**
 * Remote-Kill-Switch-Store (PLAN §3 Regel 3, M4) — Main-Prozess.
 *
 * Zweck: Einen Abo-Backend-Pfad über Nacht deaktivieren können, OHNE Release.
 *
 * Design (fail-safe, in dieser Reihenfolge):
 *   1. Gebündelter Default (alle Abo-Backends aktiv, shared/backends.ts).
 *   2. Überschrieben von einer Remote-JSON von einer konfigurierbaren URL.
 *   3. Die zuletzt erfolgreich geladene Remote-Config wird nach `<userData>`
 *      gecacht (mit TTL). Netzfehler → letzter Cache → gebündelter Default.
 *   4. Eine strukturell kaputte Remote-/Cache-Config wird IGNORIERT
 *      (coerceKillSwitchConfig → null), nie teilweise übernommen.
 *
 * Der Fetch blockiert NIE den App-Start (refreshInBackground = fire-and-forget)
 * und sendet KEINE Nutzerdaten (reiner GET, kein Body, keine Query, keine
 * Credentials).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  coerceKillSwitchConfig,
  resolveKillSwitch,
  type KillSwitchConfig,
} from '../shared/backends';

/** Holt und parst die Remote-Config. Injizierbar für Tests. Wirft bei Fehlern. */
export type KillSwitchFetch = (url: string) => Promise<unknown>;

/** Default-Fetch über das globale `fetch` (Node ≥18). Keine Nutzerdaten. */
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
  /** Cache-Datei unter `<userData>` (z. B. backends-cache.json). */
  cacheFilePath: string;
  /** Remote-URL der `backends.json` (AdminCave-gehostet). Fehlt sie, kein Fetch. */
  remoteUrl?: string;
  /** Cache-Lebensdauer in ms (Default: 60 Minuten). */
  ttlMs?: number;
  /** Fetch-Implementierung (Default: globales fetch). */
  fetchConfig?: KillSwitchFetch;
  /** Zeitquelle in ms (Default: Date.now). */
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

  /** Zuletzt erfolgreich geladene, gültige Remote-Config (last-known-good). */
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
   * Effektiver Kill-Switch JETZT (synchron, nie werfend): gebündelter Default,
   * überschrieben von der zuletzt bekannten guten Remote-Config.
   */
  effective(): KillSwitchConfig {
    return resolveKillSwitch(this.remote);
  }

  /** Ist der letzte erfolgreiche Fetch noch innerhalb der TTL? */
  private isFresh(): boolean {
    return this.remote !== null && this.now() - this.fetchedAt < this.ttlMs;
  }

  /**
   * Aktualisiert die Remote-Config. Fail-safe: bei Netzfehler oder kaputter
   * Antwort bleibt der letzte gute Zustand erhalten (Cache → Default). Wirft nie.
   * Läuft nicht doppelt (In-flight-Deduplizierung).
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
          // Gültig → als last-known-good übernehmen und cachen.
          this.remote = config;
          this.fetchedAt = this.now();
          this.persist();
        }
        // Kaputt (null) → ignorieren, alter Zustand bleibt (fail-safe).
      } catch {
        // Netzfehler → letzter Cache/Default bleibt (fail-safe).
      } finally {
        this.inflight = null;
      }
      return this.effective();
    })();
    return this.inflight;
  }

  /** Fire-and-forget: blockiert NIE den App-Start (PLAN §3). */
  refreshInBackground(): void {
    void this.refresh().catch(() => undefined);
  }

  /* ---------------- Cache-Persistenz ---------------- */

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
      /* Kaputter Cache → ignorieren, gebündelter Default greift. */
    }
  }

  private persist(): void {
    if (this.remote === null) return;
    try {
      mkdirSync(dirname(this.cacheFilePath), { recursive: true });
      const payload: CacheFile = { fetchedAt: this.fetchedAt, config: this.remote };
      writeFileSync(this.cacheFilePath, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* Best effort — der In-Memory-Zustand bleibt führend. */
    }
  }
}
