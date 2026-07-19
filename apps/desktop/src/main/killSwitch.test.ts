/**
 * Headless tests of the remote kill-switch store (PLAN §3 Rule 3, M4). The fetch
 * is injected, the cache lives in a temporary directory, the time source is
 * injected → deterministic, without network.
 *
 * Core guarantees: bundled default · remote override · ignore malformed · network
 * error → last-known-good · TTL · cache round-trip. Fail-safe: the store never
 * throws.
 *
 * Runtime-testable only (not here): the real HTTP fetch against the AdminCave URL.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { killSwitchFor } from '../shared/backends';
import { KillSwitchStore } from './killSwitch';

let tmp: string;
let cacheFile: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-killswitch-'));
  cacheFile = join(tmp, 'backends-cache.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const REMOTE_URL = 'https://updates.example.test/backends.json';

describe('KillSwitchStore — default without remote/cache', () => {
  it('returns the bundled default (all subscription backends active)', () => {
    const store = new KillSwitchStore({ cacheFilePath: cacheFile });
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(true);
    expect(killSwitchFor(store.effective(), 'claude-cli').enabled).toBe(true);
  });
});

describe('KillSwitchStore — remote override', () => {
  it('adopts a valid remote config and writes the cache', async () => {
    const fetchConfig = vi.fn(async () => ({
      backends: { codex: { enabled: false, reason: 'Über Nacht deaktiviert.' } },
    }));
    const store = new KillSwitchStore({ cacheFilePath: cacheFile, remoteUrl: REMOTE_URL, fetchConfig });

    await store.refresh();

    expect(fetchConfig).toHaveBeenCalledWith(REMOTE_URL);
    expect(killSwitchFor(store.effective(), 'codex')).toEqual({
      enabled: false,
      reason: 'Über Nacht deaktiviert.',
    });
    // Cache was written.
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { config: { backends: unknown } };
    expect(cached.config.backends).toMatchObject({ codex: { enabled: false } });
  });
});

describe('KillSwitchStore — malformed remote is ignored', () => {
  it('keeps the last good state on a broken response', async () => {
    const responses: unknown[] = [
      { backends: { codex: { enabled: false, reason: 'aus' } } }, // good
      { total: 'garbage' }, // broken → ignore
    ];
    let call = 0;
    const fetchConfig = vi.fn(async () => responses[call++]);
    const store = new KillSwitchStore({
      cacheFilePath: cacheFile,
      remoteUrl: REMOTE_URL,
      ttlMs: 0, // always refetch
      fetchConfig,
    });

    await store.refresh(true);
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(false);

    // Second fetch returns garbage → last-known-good remains (codex still off).
    await store.refresh(true);
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(false);
  });
});

describe('KillSwitchStore — network error → last-known-good', () => {
  it('uses the cache when the fetch throws', async () => {
    // Pre-fill the cache (simulates an earlier successful run).
    writeFileSync(
      cacheFile,
      JSON.stringify({
        fetchedAt: 1000,
        config: { backends: { 'grok-cli': { enabled: false, reason: 'xAI-Pfad pausiert.' } } },
      }),
    );
    const fetchConfig = vi.fn(async () => {
      throw new Error('ENETUNREACH');
    });
    const store = new KillSwitchStore({
      cacheFilePath: cacheFile,
      remoteUrl: REMOTE_URL,
      ttlMs: 0,
      fetchConfig,
    });

    // The last good state already comes from the cache.
    expect(killSwitchFor(store.effective(), 'grok-cli').enabled).toBe(false);

    // Refresh does NOT throw and leaves the good state intact (fail-safe).
    await expect(store.refresh(true)).resolves.toBeDefined();
    expect(killSwitchFor(store.effective(), 'grok-cli').enabled).toBe(false);
  });
});

describe('KillSwitchStore — TTL', () => {
  it('does not refetch within the TTL, but does afterwards', async () => {
    let clock = 10_000;
    const fetchConfig = vi.fn(async () => ({ backends: { codex: { enabled: true } } }));
    const store = new KillSwitchStore({
      cacheFilePath: cacheFile,
      remoteUrl: REMOTE_URL,
      ttlMs: 5_000,
      fetchConfig,
      now: () => clock,
    });

    await store.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    // Within the TTL: no second fetch.
    clock += 1_000;
    await store.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    // After the TTL expires: a new fetch.
    clock += 10_000;
    await store.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });
});

describe('KillSwitchStore — cache round-trip', () => {
  it('reads an existing cache as last-known-good', () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        fetchedAt: 42,
        config: { version: 3, backends: { 'gemini-cli': { enabled: false, reason: 'Wartung.' } } },
      }),
    );
    const store = new KillSwitchStore({ cacheFilePath: cacheFile, remoteUrl: REMOTE_URL });
    expect(killSwitchFor(store.effective(), 'gemini-cli')).toEqual({
      enabled: false,
      reason: 'Wartung.',
    });
  });

  it('ignores a corrupt cache and uses the default', () => {
    writeFileSync(cacheFile, '{ kaputt');
    const store = new KillSwitchStore({ cacheFilePath: cacheFile });
    expect(killSwitchFor(store.effective(), 'gemini-cli').enabled).toBe(true);
  });
});

describe('KillSwitchStore — without remoteUrl', () => {
  it('does not fetch and returns the default', async () => {
    const fetchConfig = vi.fn();
    const store = new KillSwitchStore({ cacheFilePath: cacheFile, fetchConfig });
    await store.refresh(true);
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(true);
  });
});
