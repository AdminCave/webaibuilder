/**
 * Watchdog tests for the CLI engine (fake timers + FakeChild, no real CLIs):
 * a silently hanging CLI (protocol drift, no result event) must not keep the UI
 * stuck forever in "The AI is working …" — the turn aborts with an error and the
 * process is terminated. Regular output and open permission requests, by
 * contrast, do NOT trigger an abort.
 */

import type { AgentEvent, AgentTurnRequest } from '@webaibuilder/core';
import { DEFAULT_PERMISSION_POLICY } from '@webaibuilder/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCliBackend, type CliSpec } from '../src/cliEngine';
import { controllableSpawn } from './helpers/fakeSpawn';

const spec: CliSpec = {
  id: 'codex',
  binary: 'fake-cli',
  capabilities: () => ({ resume: false, partialText: true, cost: false }),
  notFound: () => ({ type: 'error', message: 'not installed', recoverable: false }),
  buildInvocation: () => ({ args: [], keepStdinOpen: true }),
  mapLine: (json, state) => {
    if (json['kind'] === 'text') {
      return [{ type: 'text-delta', text: String(json['text']) }];
    }
    if (json['kind'] === 'perm') {
      return [
        { type: 'permission-request', requestId: 'r1', scope: 'shell', description: 'May I?' },
      ];
    }
    if (json['kind'] === 'done') {
      state.done = true;
      return [];
    }
    return [];
  },
};

function request(): AgentTurnRequest {
  return {
    workspaceDir: '/tmp/wab-fake',
    siteDir: '/tmp/wab-fake/site',
    prompt: 'Build a page',
    policy: DEFAULT_PERMISSION_POLICY,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('cliEngine — Watchdog', () => {
  it('aborts a silently hanging CLI after the timeout (error + turn-complete + kill)', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000, killGraceMs: 50 });

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) events.push(ev);
    })();

    // Let the engine start up (listeners + watchdog armed), then go silent.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(child.killSignals).toContain('SIGTERM');
    child.emitClose(null, 'SIGTERM');
    await consumed;

    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ type: 'error', recoverable: true });
    expect(error?.type === 'error' ? error.message : '').toMatch(/has not responded/);
    expect(events.at(-1)).toMatchObject({ type: 'turn-complete', stopReason: 'error' });
  });

  it('escalates to SIGKILL after the grace period when the CLI does not die', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000, killGraceMs: 50 });

    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) void ev;
    })();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // watchdog → SIGTERM
    await vi.advanceTimersByTimeAsync(50); // grace period elapsed → SIGKILL
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);

    child.emitClose(null, 'SIGKILL');
    await consumed;
  });

  it('regular output re-arms the watchdog — no abort', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000 });

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) events.push(ev);
    })();

    await vi.advanceTimersByTimeAsync(0);
    // 2400 ms total > timeout, but each chunk stays under 1000 ms.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(800);
      child.emitLine({ kind: 'text', text: `t${i}` });
      await vi.advanceTimersByTimeAsync(0);
    }
    child.emitLine({ kind: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    child.emitClose(0, null);
    await consumed;

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(child.killSignals).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'turn-complete', stopReason: 'end' });
  });

  it('pauses while a permission request is open (the user may deliberate as long as they like)', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000 });
    const iterator = backend.runTurn(request())[Symbol.asyncIterator]();

    const first = iterator.next(); // starts the engine
    await vi.advanceTimersByTimeAsync(0);
    child.emitLine({ kind: 'perm' });
    expect((await first).value).toMatchObject({ type: 'permission-request' });

    // The user "deliberates" far longer than the timeout — no kill, no error.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.killSignals).toHaveLength(0);

    // After the answer the watchdog is active again: renewed silence → abort.
    const afterAnswer = iterator.next({ requestId: 'r1', allow: true });
    await vi.advanceTimersByTimeAsync(0); // resume microtask: watchdog re-armed
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.killSignals).toContain('SIGTERM');
    expect((await afterAnswer).value).toMatchObject({ type: 'error' });

    child.emitClose(null, 'SIGTERM');
    let last: AgentEvent | undefined;
    for (;;) {
      const result = await iterator.next();
      if (result.done === true) break;
      last = result.value;
    }
    expect(last).toMatchObject({ type: 'turn-complete', stopReason: 'error' });
  });

  it('idleTimeoutMs: 0 turns the watchdog off', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 0 });

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) events.push(ev);
    })();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000); // long silence — nothing happens
    expect(child.killSignals).toHaveLength(0);

    child.emitLine({ kind: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    child.emitClose(0, null);
    await consumed;
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
