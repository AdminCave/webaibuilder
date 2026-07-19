/**
 * Tests for backend detection (detectBackends) with injected which/probe fakes —
 * NO real CLIs. Cases: installed+logged-in, installed+not-logged-in, not
 * installed. Plus byok/claude-sdk (M2 availability), install hints, the
 * experimental flag (grok) and the kill switch.
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
  it('installed + logged in: installed/loggedIn/version/account set', async () => {
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
    // grok is marked as experimental.
    expect(map['grok-cli']?.experimental).toBe(true);
    expect(map['claude-cli']?.experimental).toBeUndefined();
  });

  it('installed + not logged in: installed true, loggedIn false', async () => {
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

  it('not installed: installed false, loggedIn unknown, hint present anyway', async () => {
    const list = await detectBackends({ which: whichNone, keyEnv: {} });
    const map = byId(list);
    for (const id of CLI_IDS) {
      expect(map[id]?.installed).toBe(false);
      expect(map[id]?.loggedIn).toBeUndefined();
      expect(map[id]?.installHintUrl).toMatch(/^https:\/\//);
    }
    // The probe must not run when nothing is found.
  });

  it('byok always available; claude-sdk depends on ANTHROPIC_API_KEY', async () => {
    const withKey = byId(await detectBackends({ which: whichNone, keyEnv: { ANTHROPIC_API_KEY: 'x' } }));
    expect(withKey.byok?.installed).toBe(true);
    expect(withKey['claude-sdk']?.installed).toBe(true);

    const withoutKey = byId(await detectBackends({ which: whichNone, keyEnv: {} }));
    expect(withoutKey['claude-sdk']?.installed).toBe(false);
  });

  it('per-provider kill switch is passed through', async () => {
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

  it('returns all six backends', async () => {
    const list = await detectBackends({ which: whichNone, keyEnv: {} });
    const ids = list.map((b) => b.id).sort();
    expect(ids).toEqual(['byok', 'claude-cli', 'claude-sdk', 'codex', 'gemini-cli', 'grok-cli']);
  });
});
