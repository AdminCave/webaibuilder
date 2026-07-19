/**
 * Watchdog-Tests der CLI-Engine (fake timers + FakeChild, keine echten CLIs):
 * eine still hängende CLI (Protokoll-Drift, kein result-Event) darf die UI
 * nicht ewig in „Die KI arbeitet …" halten — der Turn bricht mit Fehler ab und
 * der Prozess wird beendet. Regelmäßige Ausgabe und offene Permission-Anfragen
 * lösen dagegen KEINEN Abbruch aus.
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
  notFound: () => ({ type: 'error', message: 'nicht installiert', recoverable: false }),
  buildInvocation: () => ({ args: [], keepStdinOpen: true }),
  mapLine: (json, state) => {
    if (json['kind'] === 'text') {
      return [{ type: 'text-delta', text: String(json['text']) }];
    }
    if (json['kind'] === 'perm') {
      return [
        { type: 'permission-request', requestId: 'r1', scope: 'shell', description: 'Darf ich?' },
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
    prompt: 'Bau eine Seite',
    policy: DEFAULT_PERMISSION_POLICY,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('cliEngine — Watchdog', () => {
  it('bricht eine still hängende CLI nach dem Timeout ab (error + turn-complete + kill)', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000, killGraceMs: 50 });

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) events.push(ev);
    })();

    // Engine anlaufen lassen (Listener + Watchdog armiert), dann Stille.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(child.killSignals).toContain('SIGTERM');
    child.emitClose(null, 'SIGTERM');
    await consumed;

    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ type: 'error', recoverable: true });
    expect(error?.type === 'error' ? error.message : '').toMatch(/nicht geantwortet/);
    expect(events.at(-1)).toMatchObject({ type: 'turn-complete', stopReason: 'error' });
  });

  it('eskaliert nach der Grace-Zeit auf SIGKILL, wenn die CLI nicht stirbt', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000, killGraceMs: 50 });

    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) void ev;
    })();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // Watchdog → SIGTERM
    await vi.advanceTimersByTimeAsync(50); // Grace verstrichen → SIGKILL
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);

    child.emitClose(null, 'SIGKILL');
    await consumed;
  });

  it('regelmäßige Ausgabe armiert den Watchdog neu — kein Abbruch', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000 });

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) events.push(ev);
    })();

    await vi.advanceTimersByTimeAsync(0);
    // Insgesamt 2400 ms > Timeout, aber jeder Chunk liegt unter 1000 ms.
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

  it('pausiert bei offener Permission-Anfrage (Nutzer darf beliebig lange überlegen)', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 1000 });
    const iterator = backend.runTurn(request())[Symbol.asyncIterator]();

    const first = iterator.next(); // startet die Engine
    await vi.advanceTimersByTimeAsync(0);
    child.emitLine({ kind: 'perm' });
    expect((await first).value).toMatchObject({ type: 'permission-request' });

    // Nutzer „überlegt" weit länger als das Timeout — kein Kill, kein Fehler.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.killSignals).toHaveLength(0);

    // Nach der Antwort ist der Watchdog wieder aktiv: erneute Stille → Abbruch.
    const afterAnswer = iterator.next({ requestId: 'r1', allow: true });
    await vi.advanceTimersByTimeAsync(0); // Resume-Mikrotask: Watchdog neu armiert
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

  it('idleTimeoutMs: 0 schaltet den Watchdog aus', async () => {
    vi.useFakeTimers();
    const { child, spawn } = controllableSpawn();
    const backend = createCliBackend(spec, { spawn, idleTimeoutMs: 0 });

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const ev of backend.runTurn(request())) events.push(ev);
    })();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000); // lange Stille — nichts passiert
    expect(child.killSignals).toHaveLength(0);

    child.emitLine({ kind: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    child.emitClose(0, null);
    await consumed;
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
