/**
 * Tests für die Backend-Erkennung (detectBackends) mit injizierten which-/probe-
 * Fakes — KEINE echten CLIs. Fälle: installiert+eingeloggt, installiert+nicht-
 * eingeloggt, nicht installiert. Plus byok/claude-sdk (M2-Verfügbarkeit),
 * Install-Hinweise, experimental-Flag (grok) und Kill-Switch.
 */

import type { BackendId } from '@webaibuilder/core';
import { describe, expect, it } from 'vitest';

import { detectBackends, type BackendAvailability } from '../src/index';
import type { ProbeFn, ProbeResult, WhichFn } from '../src/detect';

const CLI_IDS: BackendId[] = ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'];

const whichAll: WhichFn = async (binary) => `/usr/local/bin/${binary}`;
const whichNone: WhichFn = async () => null;

function probeReturning(result: ProbeResult): ProbeFn {
  return async () => result;
}

function byId(list: BackendAvailability[]): Record<string, BackendAvailability> {
  return Object.fromEntries(list.map((b) => [b.id, b]));
}

describe('detectBackends', () => {
  it('installiert + eingeloggt: installed/loggedIn/version/account gesetzt', async () => {
    const list = await detectBackends({
      which: whichAll,
      probe: probeReturning({ loggedIn: true, version: '1.2.3', account: 'du@example.de' }),
      keyEnv: {},
    });
    const map = byId(list);
    for (const id of CLI_IDS) {
      expect(map[id]?.installed).toBe(true);
      expect(map[id]?.loggedIn).toBe(true);
      expect(map[id]?.version).toBe('1.2.3');
      expect(map[id]?.account).toBe('du@example.de');
      expect(map[id]?.installHintUrl).toMatch(/^https:\/\//);
    }
    // grok ist als experimentell markiert.
    expect(map['grok-cli']?.experimental).toBe(true);
    expect(map['claude-cli']?.experimental).toBeUndefined();
  });

  it('installiert + nicht eingeloggt: installed true, loggedIn false', async () => {
    const list = await detectBackends({
      which: whichAll,
      probe: probeReturning({ loggedIn: false, version: '2.0.0' }),
      keyEnv: {},
    });
    const map = byId(list);
    for (const id of CLI_IDS) {
      expect(map[id]?.installed).toBe(true);
      expect(map[id]?.loggedIn).toBe(false);
    }
  });

  it('nicht installiert: installed false, loggedIn unbekannt, Hinweis trotzdem da', async () => {
    const list = await detectBackends({ which: whichNone, keyEnv: {} });
    const map = byId(list);
    for (const id of CLI_IDS) {
      expect(map[id]?.installed).toBe(false);
      expect(map[id]?.loggedIn).toBeUndefined();
      expect(map[id]?.installHintUrl).toMatch(/^https:\/\//);
    }
    // Der Probe darf nicht laufen, wenn nichts gefunden wird.
  });

  it('byok immer verfügbar; claude-sdk hängt am ANTHROPIC_API_KEY', async () => {
    const withKey = byId(await detectBackends({ which: whichNone, keyEnv: { ANTHROPIC_API_KEY: 'x' } }));
    expect(withKey.byok?.installed).toBe(true);
    expect(withKey['claude-sdk']?.installed).toBe(true);

    const withoutKey = byId(await detectBackends({ which: whichNone, keyEnv: {} }));
    expect(withoutKey['claude-sdk']?.installed).toBe(false);
  });

  it('Kill-Switch pro Anbieter wird durchgereicht', async () => {
    const list = await detectBackends({
      which: whichAll,
      probe: probeReturning({ loggedIn: true }),
      keyEnv: {},
      killSwitched: (id) => id === 'claude-cli',
    });
    const map = byId(list);
    expect(map['claude-cli']?.killSwitched).toBe(true);
    expect(map.codex?.killSwitched).toBe(false);
  });

  it('liefert alle sechs Backends', async () => {
    const list = await detectBackends({ which: whichNone, keyEnv: {} });
    const ids = list.map((b) => b.id).sort();
    expect(ids).toEqual(['byok', 'claude-cli', 'claude-sdk', 'codex', 'gemini-cli', 'grok-cli']);
  });
});
