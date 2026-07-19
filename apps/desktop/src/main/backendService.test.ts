/**
 * Headless tests of the backend orchestration (PLAN §3/§4, M4). Detection,
 * kill-switch source, and ack store are injected fakes → deterministic, without
 * real CLI probing and without network.
 *
 * Runtime-testable only (not here): the real `detectBackends()` CLI probing and
 * real Electron IPC.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackendId } from '@webaibuilder/core';

import { coerceKillSwitchConfig, resolveKillSwitch, type KillSwitchConfig } from '../shared/backends';
import { BackendService, FileAckStore, type AckStore, type KillSwitchSource } from './backendService';

function killSwitchSource(config: KillSwitchConfig = resolveKillSwitch(null)): KillSwitchSource {
  return { effective: () => config };
}

function memoryAckStore(initial: BackendId[] = []): AckStore {
  const ids = [...initial];
  return {
    list: () => [...ids],
    add: (id) => {
      if (!ids.includes(id)) ids.push(id);
    },
  };
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-backends-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('BackendService — availability + kill-switch merge', () => {
  it('returns all six backends and reports a disabled one with a reason', async () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'grok-cli': { enabled: false, reason: 'xAI-Pfad pausiert.' } },
    });
    const service = new BackendService({
      detect: async () => [
        { id: 'byok', installed: true },
        { backendId: 'codex', installed: true, loggedIn: true, account: 'a@b.de' },
        { backendId: 'grok-cli', installed: true, loggedIn: true },
      ],
      killSwitch: killSwitchSource(resolveKillSwitch(remote)),
      acks: memoryAckStore(),
    });

    const state = await service.availability();
    expect(state.backends.map((b) => b.backendId)).toEqual([
      'byok',
      'claude-sdk',
      'claude-cli',
      'codex',
      'gemini-cli',
      'grok-cli',
    ]);

    const grok = state.backends.find((b) => b.backendId === 'grok-cli');
    expect(grok?.enabled).toBe(false);
    expect(grok?.disabledReason).toBe('xAI-Pfad pausiert.');
    expect(grok?.experimental).toBe(true);

    const codex = state.backends.find((b) => b.backendId === 'codex');
    expect(codex?.installed).toBe(true);
    expect(codex?.account).toBe('a@b.de');

    // Backends not returned by detection → defensively "not installed".
    expect(state.backends.find((b) => b.backendId === 'gemini-cli')?.installed).toBe(false);
  });

  it('caches detection and only re-probes on refresh', async () => {
    const detect = vi.fn(async () => [{ backendId: 'codex', installed: true, loggedIn: true }]);
    const service = new BackendService({
      detect,
      killSwitch: killSwitchSource(),
      acks: memoryAckStore(),
    });

    await service.availability();
    await service.availability();
    expect(detect).toHaveBeenCalledTimes(1); // cached

    await service.refresh();
    expect(detect).toHaveBeenCalledTimes(2); // re-probed
  });

  it('reports all backends as not installed on a detection error (fail-safe)', async () => {
    const service = new BackendService({
      detect: async () => {
        throw new Error('CLI-Probe abgestürzt');
      },
      killSwitch: killSwitchSource(),
      acks: memoryAckStore(),
    });
    const state = await service.availability();
    expect(state.backends).toHaveLength(6);
    expect(state.backends.every((b) => b.installed === false)).toBe(true);
  });
});

describe('BackendService — acknowledgment (Claude subscription notice)', () => {
  it('persists the acknowledgment and reflects it in the state', async () => {
    const acks = memoryAckStore();
    const addSpy = vi.spyOn(acks, 'add');
    const service = new BackendService({
      detect: async () => [{ backendId: 'claude-cli', installed: true, loggedIn: true }],
      killSwitch: killSwitchSource(),
      acks,
    });

    const before = await service.availability();
    const claudeBefore = before.backends.find((b) => b.backendId === 'claude-cli');
    expect(claudeBefore?.acknowledged).toBe(false);
    expect(claudeBefore?.requiresAck).toBe(true);

    const after = await service.acknowledge('claude-cli');
    expect(addSpy).toHaveBeenCalledWith('claude-cli');
    expect(after.acknowledged).toContain('claude-cli');
    expect(after.backends.find((b) => b.backendId === 'claude-cli')?.acknowledged).toBe(true);
  });
});

describe('FileAckStore — persistence', () => {
  it('stores acknowledged backends and reads them on restart', () => {
    const file = join(tmp, 'backend-acks.json');
    const first = new FileAckStore(file);
    expect(first.list()).toEqual([]);
    first.add('claude-cli');
    first.add('claude-cli'); // idempotent

    const second = new FileAckStore(file);
    expect(second.list()).toEqual(['claude-cli']);
  });

  it('ignores corrupt/invalid contents', () => {
    const file = join(tmp, 'acks.json');
    writeFileSync(file, JSON.stringify(['claude-cli', 'gibts-nicht', 42]));
    const store = new FileAckStore(file);
    expect(store.list()).toEqual(['claude-cli']); // only valid BackendIds

    writeFileSync(file, '{ kaputt');
    expect(new FileAckStore(file).list()).toEqual([]);
  });

  it('writes valid JSON to disk', () => {
    const file = join(tmp, 'a.json');
    new FileAckStore(file).add('claude-cli');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['claude-cli']);
  });
});
