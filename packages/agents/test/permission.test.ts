/**
 * Permission-Rückkanal (PLAN §11-Naht, in M4 reconciled).
 *
 * Der Vertrag: `runTurn` ist ein async Generator. Yieldet er ein
 * `permission-request`, kommt die Nutzer-Entscheidung als Rückgabewert des
 * `yield` zurück (Desktop treibt mit `iterator.next(decision)`). Fehlt eine
 * Entscheidung (Generator wird ohne `next(decision)` durchlaufen), gilt
 * fail-safe DENY.
 *
 * Geprüft an zwei Backends mit echtem Permission-Pfad:
 *   - claude-cli: Antwort geht als `control_response` auf stdin (allow/deny).
 *   - claude-sdk: Antwort steuert das `canUseTool`-Ergebnis (allow/deny).
 */

import type { AgentEvent, AgentTurnRequest, PermissionDecision } from '@webaibuilder/core';
import { DEFAULT_PERMISSION_POLICY } from '@webaibuilder/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Vendor-SDK mocken, damit claude-sdk `canUseTool` real aufruft.
const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { createClaudeCliBackend } from '../src/claudeCli';
import { createClaudeSdkBackend } from '../src/claudeSdk';
import { controllableSpawn } from './helpers/fakeSpawn';

const siteDir = '/tmp/wab-perm/site';

function request(prompt: string): AgentTurnRequest {
  return { workspaceDir: '/tmp/wab-perm', siteDir, prompt, policy: DEFAULT_PERMISSION_POLICY };
}

const CONTROL_REQUEST = {
  type: 'control_request',
  request_id: 'perm-1',
  request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } },
};

interface ControlResponse {
  type?: string;
  response?: { request_id?: string; response?: { behavior?: string; message?: string } };
}

function controlResponses(chunks: readonly string[]): ControlResponse[] {
  return chunks
    .map((c) => {
      try {
        return JSON.parse(c) as ControlResponse;
      } catch {
        return {};
      }
    })
    .filter((o) => o.type === 'control_response');
}

/* ------------------------------------------------------------------ */
/* claude-cli: control_response über stdin                             */
/* ------------------------------------------------------------------ */

describe('claude-cli Permission-Rückkanal', () => {
  async function driveWithDecision(
    decision: PermissionDecision | undefined,
  ): Promise<{ events: AgentEvent[]; stdin: string[] }> {
    const { child, spawn } = controllableSpawn();
    const backend = createClaudeCliBackend({ spawn });
    const iterator = backend.runTurn(request('mach was'))[Symbol.asyncIterator]() as AsyncIterator<
      AgentEvent,
      unknown,
      PermissionDecision | undefined
    >;

    const events: AgentEvent[] = [];
    const first = iterator.next();
    child.emitLine(CONTROL_REQUEST);
    let step = await first;

    let resume: PermissionDecision | undefined;
    for (;;) {
      if (step.done === true) break;
      const event = step.value;
      events.push(event);
      if (event.type === 'permission-request') {
        // Nach dem Yield des permission-request Ergebnis-Zeilen nachschieben.
        resume = decision;
        child.emitLine({ type: 'result', subtype: 'success', session_id: 's' });
        child.emitClose(0, null);
      }
      step = await iterator.next(resume);
      resume = undefined;
    }
    return { events, stdin: child.stdinChunks };
  }

  it('allow → control_response mit behavior "allow"', async () => {
    const { events, stdin } = await driveWithDecision({ requestId: 'perm-1', allow: true });
    const perm = events.find((e) => e.type === 'permission-request');
    expect(perm).toMatchObject({ type: 'permission-request', requestId: 'perm-1', scope: 'shell' });

    const responses = controlResponses(stdin);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.response?.request_id).toBe('perm-1');
    expect(responses[0]?.response?.response?.behavior).toBe('allow');
  });

  it('deny → control_response mit behavior "deny"', async () => {
    const { stdin } = await driveWithDecision({ requestId: 'perm-1', allow: false });
    const responses = controlResponses(stdin);
    expect(responses[0]?.response?.response?.behavior).toBe('deny');
  });

  it('ohne Entscheidung durchlaufen → fail-safe deny', async () => {
    // Generator per for-await treiben → yield liefert immer undefined zurück.
    const { child, spawn } = controllableSpawn();
    const backend = createClaudeCliBackend({ spawn });
    const iterator = backend.runTurn(request('mach was'))[Symbol.asyncIterator]();
    const first = iterator.next();
    child.emitLine(CONTROL_REQUEST);
    await first; // permission-request
    // Kein next(decision) — direkt Ergebnis + Ende nachschieben.
    child.emitLine({ type: 'result', subtype: 'success' });
    child.emitClose(0, null);
    for (;;) {
      const { done } = await iterator.next(); // ohne Argument
      if (done) break;
    }
    const responses = controlResponses(child.stdinChunks);
    expect(responses[0]?.response?.response?.behavior).toBe('deny');
  });
});

/* ------------------------------------------------------------------ */
/* claude-sdk: canUseTool-Ergebnis                                     */
/* ------------------------------------------------------------------ */

interface FakeOptions {
  canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<{ behavior: string; message?: string }>;
}

let lastBehavior: string | undefined;

function mockQueryThatAsks(): void {
  queryMock.mockImplementation((arg: unknown) => {
    const options = (arg as { options: FakeOptions }).options;
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's' };
      const result = await options.canUseTool('Bash', { command: 'ls' });
      lastBehavior = result.behavior;
      const text = result.behavior === 'allow' ? 'erlaubt' : 'abgelehnt';
      yield {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      };
      yield { type: 'result', subtype: 'success', session_id: 's' };
    })();
  });
}

describe('claude-sdk Permission-Rückkanal', () => {
  beforeEach(() => {
    queryMock.mockReset();
    lastBehavior = undefined;
    mockQueryThatAsks();
  });

  async function driveSdk(
    supply: (event: AgentEvent) => PermissionDecision | undefined,
  ): Promise<AgentEvent[]> {
    const backend = createClaudeSdkBackend({ apiKey: 'k' });
    const iterator = backend.runTurn(request('mach was'))[Symbol.asyncIterator]() as AsyncIterator<
      AgentEvent,
      unknown,
      PermissionDecision | undefined
    >;
    const events: AgentEvent[] = [];
    let resume: PermissionDecision | undefined;
    for (;;) {
      const { value, done } = await iterator.next(resume);
      if (done === true) break;
      events.push(value);
      resume = supply(value);
    }
    return events;
  }

  it('allow → canUseTool erlaubt, Tool läuft', async () => {
    const events = await driveSdk((e) =>
      e.type === 'permission-request' ? { requestId: e.requestId, allow: true } : undefined,
    );
    expect(lastBehavior).toBe('allow');
    expect(events.some((e) => e.type === 'text-delta' && e.text === 'erlaubt')).toBe(true);
    expect(events.some((e) => e.type === 'permission-request' && e.scope === 'shell')).toBe(true);
  });

  it('deny → canUseTool verweigert', async () => {
    const events = await driveSdk((e) =>
      e.type === 'permission-request' ? { requestId: e.requestId, allow: false } : undefined,
    );
    expect(lastBehavior).toBe('deny');
    expect(events.some((e) => e.type === 'text-delta' && e.text === 'abgelehnt')).toBe(true);
  });

  it('ohne Entscheidung → fail-safe deny', async () => {
    await driveSdk(() => undefined); // nie eine Entscheidung liefern
    expect(lastBehavior).toBe('deny');
  });
});
