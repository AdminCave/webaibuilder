/**
 * Headless-Tests des Remote-Kill-Switch-Stores (PLAN §3 Regel 3, M4). Der Fetch
 * ist injiziert, der Cache liegt in einem temporären Verzeichnis, die Zeitquelle
 * ist injiziert → deterministisch, ohne Netz.
 *
 * Kernzusicherungen: gebündelter Default · Remote-Override · malformed ignorieren
 * · Netzfehler → last-known-good · TTL · Cache-Round-Trip. Fail-safe: der Store
 * wirft nie.
 *
 * Nur runtime-testbar (nicht hier): der echte HTTP-Abruf gegen die AdminCave-URL.
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

describe('KillSwitchStore — Default ohne Remote/Cache', () => {
  it('liefert den gebündelten Default (alle Abo-Backends aktiv)', () => {
    const store = new KillSwitchStore({ cacheFilePath: cacheFile });
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(true);
    expect(killSwitchFor(store.effective(), 'claude-cli').enabled).toBe(true);
  });
});

describe('KillSwitchStore — Remote-Override', () => {
  it('übernimmt eine gültige Remote-Config und schreibt den Cache', async () => {
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
    // Cache wurde geschrieben.
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { config: { backends: unknown } };
    expect(cached.config.backends).toMatchObject({ codex: { enabled: false } });
  });
});

describe('KillSwitchStore — malformed Remote wird ignoriert', () => {
  it('behält den letzten guten Zustand bei kaputter Antwort', async () => {
    const responses: unknown[] = [
      { backends: { codex: { enabled: false, reason: 'aus' } } }, // gut
      { total: 'garbage' }, // kaputt → ignorieren
    ];
    let call = 0;
    const fetchConfig = vi.fn(async () => responses[call++]);
    const store = new KillSwitchStore({
      cacheFilePath: cacheFile,
      remoteUrl: REMOTE_URL,
      ttlMs: 0, // immer refetchen
      fetchConfig,
    });

    await store.refresh(true);
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(false);

    // Zweiter Abruf liefert Müll → last-known-good bleibt (codex weiter aus).
    await store.refresh(true);
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(false);
  });
});

describe('KillSwitchStore — Netzfehler → last-known-good', () => {
  it('nutzt den Cache, wenn der Abruf wirft', async () => {
    // Cache vorbefüllen (simuliert einen früheren erfolgreichen Lauf).
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

    // Aus dem Cache bereits der letzte gute Zustand.
    expect(killSwitchFor(store.effective(), 'grok-cli').enabled).toBe(false);

    // Refresh wirft NICHT und lässt den guten Zustand bestehen (fail-safe).
    await expect(store.refresh(true)).resolves.toBeDefined();
    expect(killSwitchFor(store.effective(), 'grok-cli').enabled).toBe(false);
  });
});

describe('KillSwitchStore — TTL', () => {
  it('refetcht innerhalb der TTL nicht, danach schon', async () => {
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

    // Innerhalb der TTL: kein zweiter Abruf.
    clock += 1_000;
    await store.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    // Nach Ablauf der TTL: neuer Abruf.
    clock += 10_000;
    await store.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });
});

describe('KillSwitchStore — Cache-Round-Trip', () => {
  it('liest einen vorhandenen Cache als last-known-good', () => {
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

  it('ignoriert einen kaputten Cache und nutzt den Default', () => {
    writeFileSync(cacheFile, '{ kaputt');
    const store = new KillSwitchStore({ cacheFilePath: cacheFile });
    expect(killSwitchFor(store.effective(), 'gemini-cli').enabled).toBe(true);
  });
});

describe('KillSwitchStore — ohne remoteUrl', () => {
  it('macht keinen Fetch und liefert den Default', async () => {
    const fetchConfig = vi.fn();
    const store = new KillSwitchStore({ cacheFilePath: cacheFile, fetchConfig });
    await store.refresh(true);
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(killSwitchFor(store.effective(), 'codex').enabled).toBe(true);
  });
});
