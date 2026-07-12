/**
 * Tests für die vier Abo-/CLI-Adapter (M4): claude-cli · codex · gemini-cli ·
 * grok-cli. KEINE echten Vendor-CLIs — ein injizierter Fake-spawn spielt canned
 * JSONL-Transcripts ab. Geprüft: Event-Mapping inkl. turn-complete (Kosten/
 * Session), ENOENT → Fehler mit Install-Hinweis, interrupt() killt das Kind,
 * kaputte JSON-Zeilen werden übersprungen.
 */

import type { AgentEvent, AgentTurnRequest } from '@webaibuilder/core';
import { DEFAULT_PERMISSION_POLICY } from '@webaibuilder/core';
import { describe, expect, it } from 'vitest';

import { createClaudeCliBackend } from '../src/claudeCli';
import { createCodexBackend } from '../src/codex';
import { createGeminiCliBackend } from '../src/geminiCli';
import { createGrokCliBackend } from '../src/grokCli';
import { controllableSpawn, enoentSpawn, scriptedSpawn } from './helpers/fakeSpawn';

const siteDir = '/tmp/wab-fake/site';

function request(prompt: string, sessionId?: string): AgentTurnRequest {
  return {
    workspaceDir: '/tmp/wab-fake',
    siteDir,
    prompt,
    policy: DEFAULT_PERMISSION_POLICY,
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}

function textOf(events: AgentEvent[]): string {
  return events
    .filter((e): e is Extract<AgentEvent, { type: 'text-delta' }> => e.type === 'text-delta')
    .map((e) => e.text)
    .join('');
}

function lastComplete(events: AgentEvent[]): Extract<AgentEvent, { type: 'turn-complete' }> {
  const ev = events.at(-1);
  if (!ev || ev.type !== 'turn-complete') throw new Error('kein turn-complete am Ende');
  return ev;
}

/* ------------------------------------------------------------------ */
/* claude-cli                                                          */
/* ------------------------------------------------------------------ */

describe('claude-cli-Adapter', () => {
  const transcript = [
    { type: 'system', subtype: 'init', session_id: 'sess-claude' },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hallo ' } } },
    'das ist keine gültige json-zeile {{{', // muss übersprungen werden
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Welt' } } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'index.html' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.0021, session_id: 'sess-claude' },
  ];

  it('mappt init/stream_event/assistant/user/result auf AgentEvents (skippt Müll)', async () => {
    const { spawn, child, calls } = scriptedSpawn(transcript);
    const backend = createClaudeCliBackend({ spawn });
    const events = await collect(backend.runTurn(request('Bau eine Seite')));

    // Aufruf: cwd = siteDir, die verlangten stream-json-Flags.
    expect(calls[0]?.command).toBe('claude');
    expect(calls[0]?.cwd).toBe(siteDir);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
      ]),
    );
    // Prompt ging als stream-json-User-Nachricht auf stdin.
    const firstStdin = JSON.parse(child.stdinChunks[0] ?? '{}') as { type?: string; message?: { content?: string } };
    expect(firstStdin.type).toBe('user');
    expect(firstStdin.message?.content).toBe('Bau eine Seite');

    expect(textOf(events)).toBe('Hallo Welt');

    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'start' && e.tool === 'Datei schreiben' && e.detail === 'index.html')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'end')).toBe(true);

    const complete = lastComplete(events);
    expect(complete.stopReason).toBe('end');
    expect(complete.sessionId).toBe('sess-claude');
    expect(complete.costUsd).toBeCloseTo(0.0021);
  });

  it('setzt --resume bei vorhandener sessionId und meldet Capabilities', () => {
    const { spawn, calls } = scriptedSpawn([]);
    const backend = createClaudeCliBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: true, partialText: true, cost: true });
    void collect(backend.runTurn(request('weiter', 'sess-x')));
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['--resume', 'sess-x']));
  });

  it('ENOENT → Fehler-Event mit Install-Hinweis (nicht wiederherstellbar)', async () => {
    const { spawn } = enoentSpawn();
    const backend = createClaudeCliBackend({ spawn });
    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type).toBe('error');
    if (error?.type === 'error') {
      expect(error.message).toContain('Claude Code nicht gefunden');
      expect(error.message).toContain('https://docs.claude.com');
      expect(error.recoverable).toBe(false);
    }
    expect(lastComplete(events).stopReason).toBe('error');
  });

  it('interrupt() killt den Kindprozess (SIGTERM) und meldet interrupted', async () => {
    const { child, spawn } = controllableSpawn();
    const backend = createClaudeCliBackend({ spawn });
    const iterator = backend.runTurn(request('Erzähl viel'))[Symbol.asyncIterator]();

    const first = iterator.next(); // Engine startet, hängt Listener
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Teil' } } });
    const firstEvent = await first;
    expect(firstEvent.value).toMatchObject({ type: 'text-delta' });

    await backend.interrupt();
    expect(child.killSignals).toContain('SIGTERM');

    child.emitClose(null, 'SIGTERM'); // Prozess endet durch das Signal
    const rest: AgentEvent[] = [];
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) break;
      rest.push(value);
    }
    expect(lastComplete(rest).stopReason).toBe('interrupted');
  });

  it('interrupt() eskaliert nach Grace auf SIGKILL', async () => {
    const { child, spawn } = controllableSpawn();
    const backend = createClaudeCliBackend({ spawn, killGraceMs: 5 });
    const iterator = backend.runTurn(request('Erzähl viel'))[Symbol.asyncIterator]();
    const first = iterator.next();
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } });
    await first;

    await backend.interrupt();
    await new Promise((r) => setTimeout(r, 40)); // Grace verstreichen lassen
    expect(child.killSignals).toContain('SIGKILL');

    child.emitClose(null, 'SIGKILL');
    await iterator.next(); // Generator sauber beenden
  });
});

/* ------------------------------------------------------------------ */
/* codex                                                              */
/* ------------------------------------------------------------------ */

describe('codex-Adapter', () => {
  const transcript = [
    { type: 'thread.started', thread_id: 'th-1' },
    { type: 'turn.started' },
    'kaputt', // skip
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls -la' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls -la', status: 'completed' } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Fertig gebaut.' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
  ];

  it('mappt thread/item/turn-Events (agent_message → Text, command → tool-activity)', async () => {
    const { spawn, calls } = scriptedSpawn(transcript);
    const backend = createCodexBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: true, partialText: false, cost: false });

    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    expect(calls[0]?.command).toBe('codex');
    expect(calls[0]?.args).toEqual(['exec', '--json', 'Bau eine Seite']);
    expect(calls[0]?.cwd).toBe(siteDir);

    expect(textOf(events)).toBe('Fertig gebaut.');
    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Shell-Befehl' && e.phase === 'start' && e.detail === 'ls -la')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Shell-Befehl' && e.phase === 'end')).toBe(true);

    const complete = lastComplete(events);
    expect(complete.stopReason).toBe('end');
    expect(complete.sessionId).toBe('th-1');
    expect(complete.costUsd).toBeUndefined();
  });

  it('nutzt `exec resume <id>` bei vorhandener sessionId', () => {
    const { spawn, calls } = scriptedSpawn([]);
    const backend = createCodexBackend({ spawn });
    void collect(backend.runTurn(request('weiter', 'th-9')));
    expect(calls[0]?.args).toEqual(['exec', 'resume', 'th-9', '--json', 'weiter']);
  });

  it('turn.failed → Fehler-Event + stopReason error', async () => {
    const { spawn } = scriptedSpawn([
      { type: 'thread.started', thread_id: 't' },
      { type: 'turn.failed', error: { message: 'Rate limit' } },
    ]);
    const backend = createCodexBackend({ spawn });
    const events = await collect(backend.runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type).toBe('error');
    if (error?.type === 'error') expect(error.cause).toBe('Rate limit');
    expect(lastComplete(events).stopReason).toBe('error');
  });

  it('ENOENT → Fehler-Event mit Install-Hinweis', async () => {
    const { spawn } = enoentSpawn();
    const events = await collect(createCodexBackend({ spawn }).runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.message).toContain('Codex CLI nicht gefunden');
    expect(error?.type === 'error' && error.message).toContain('https://developers.openai.com');
  });
});

/* ------------------------------------------------------------------ */
/* gemini-cli                                                          */
/* ------------------------------------------------------------------ */

describe('gemini-cli-Adapter', () => {
  const transcript = [
    { type: 'init', session_id: 'g-sess', model: 'gemini-2.5-pro' },
    { type: 'message', role: 'assistant', content: 'Ich baue ', delta: true },
    'kaputte zeile',
    { type: 'message', role: 'assistant', content: 'die Seite.', delta: true },
    { type: 'tool_use', tool_name: 'WriteFile', tool_id: 't1', parameters: { file_path: 'index.html' } },
    { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 20, output_tokens: 8 } },
  ];

  it('mappt init/message/tool_use/tool_result/result auf AgentEvents', async () => {
    const { spawn, calls } = scriptedSpawn(transcript);
    const backend = createGeminiCliBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: false, partialText: true, cost: false });

    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    expect(calls[0]?.command).toBe('gemini');
    expect(calls[0]?.args).toEqual(['--output-format', 'stream-json', '--approval-mode', 'auto_edit', '-p', 'Bau eine Seite']);

    expect(textOf(events)).toBe('Ich baue die Seite.');
    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Datei schreiben' && e.phase === 'start' && e.detail === 'index.html')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'end')).toBe(true);

    expect(lastComplete(events).stopReason).toBe('end');
  });

  it('ENOENT → Fehler-Event mit Install-Hinweis (google.dev)', async () => {
    const { spawn } = enoentSpawn();
    const events = await collect(createGeminiCliBackend({ spawn }).runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.message).toContain('Gemini CLI nicht gefunden');
    expect(error?.type === 'error' && error.message).toContain('https://ai.google.dev');
  });

  it('nicht-null Exit-Code → Fehler-Event', async () => {
    const { spawn } = scriptedSpawn([{ type: 'init', session_id: 'g' }], { exitCode: 1 });
    const events = await collect(createGeminiCliBackend({ spawn }).runTurn(request('x')));
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(lastComplete(events).stopReason).toBe('error');
  });
});

/* ------------------------------------------------------------------ */
/* grok-cli (experimentell)                                            */
/* ------------------------------------------------------------------ */

describe('grok-cli-Adapter (experimentell)', () => {
  const transcript = [
    { method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Baue ' } } } },
    'kaputt {',
    { method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'jetzt.' } } } },
    { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Datei schreiben', status: 'pending' } } },
    { method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed' } } },
    { type: 'result' },
  ];

  it('mappt ACP session/update-Chunks tolerant auf AgentEvents', async () => {
    const { spawn, calls } = scriptedSpawn(transcript);
    const backend = createGrokCliBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: false, partialText: true, cost: false });

    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    expect(calls[0]?.command).toBe('grok');
    expect(calls[0]?.args).toEqual(['-p', 'Bau eine Seite', '--output-format', 'streaming-json', '--no-auto-update']);

    expect(textOf(events)).toBe('Baue jetzt.');
    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Datei schreiben' && e.phase === 'start')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'end')).toBe(true);
    expect(lastComplete(events).stopReason).toBe('end');
  });

  it('ENOENT → Fehler-Event mit Install-Hinweis (experimentell, x.ai)', async () => {
    const { spawn } = enoentSpawn();
    const events = await collect(createGrokCliBackend({ spawn }).runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.message).toContain('Grok Build CLI nicht gefunden');
    expect(error?.type === 'error' && error.message).toContain('https://docs.x.ai');
    expect(error?.type === 'error' && error.message).toContain('experimentell');
  });
});
