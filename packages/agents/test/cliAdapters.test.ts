/**
 * Tests for the four subscription/CLI adapters (M4): claude-cli · codex ·
 * gemini-cli · grok-cli. NO real vendor CLIs — an injected fake spawn plays back
 * canned JSONL transcripts. Checked: event mapping incl. turn-complete (cost/
 * session), ENOENT → error with an install hint, interrupt() kills the child,
 * broken JSON lines are skipped.
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
  if (!ev || ev.type !== 'turn-complete') throw new Error('no turn-complete at the end');
  return ev;
}

/* ------------------------------------------------------------------ */
/* claude-cli                                                          */
/* ------------------------------------------------------------------ */

describe('claude-cli adapter', () => {
  const transcript = [
    { type: 'system', subtype: 'init', session_id: 'sess-claude' },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hallo ' } } },
    'das ist keine gültige json-zeile {{{', // must be skipped
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Welt' } } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'index.html' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.0021, session_id: 'sess-claude' },
  ];

  it('maps init/stream_event/assistant/user/result onto AgentEvents (skips junk)', async () => {
    const { spawn, child, calls } = scriptedSpawn(transcript);
    const backend = createClaudeCliBackend({ spawn });
    const events = await collect(backend.runTurn(request('Bau eine Seite')));

    // Call: cwd = siteDir, the required stream-json flags.
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
    // The prompt went to stdin as a stream-json user message.
    const firstStdin = JSON.parse(child.stdinChunks[0] ?? '{}') as { type?: string; message?: { content?: string } };
    expect(firstStdin.type).toBe('user');
    expect(firstStdin.message?.content).toBe('Bau eine Seite');

    expect(textOf(events)).toBe('Hallo Welt');

    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'start' && e.tool === 'Write file' && e.detail === 'index.html')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'end')).toBe(true);

    const complete = lastComplete(events);
    expect(complete.stopReason).toBe('end');
    expect(complete.sessionId).toBe('sess-claude');
    expect(complete.costUsd).toBeCloseTo(0.0021);
  });

  it('sets --resume when a sessionId is present and reports capabilities', () => {
    const { spawn, calls } = scriptedSpawn([]);
    const backend = createClaudeCliBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: true, partialText: true, cost: true });
    void collect(backend.runTurn(request('weiter', 'sess-x')));
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['--resume', 'sess-x']));
  });

  it('ENOENT → error event with install hint (not recoverable)', async () => {
    const { spawn } = enoentSpawn();
    const backend = createClaudeCliBackend({ spawn });
    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type).toBe('error');
    if (error?.type === 'error') {
      expect(error.message).toContain('Claude Code not found');
      expect(error.message).toContain('https://docs.claude.com');
      expect(error.recoverable).toBe(false);
    }
    expect(lastComplete(events).stopReason).toBe('error');
  });

  it('interrupt() kills the child process (SIGTERM) and reports interrupted', async () => {
    const { child, spawn } = controllableSpawn();
    const backend = createClaudeCliBackend({ spawn });
    const iterator = backend.runTurn(request('Erzähl viel'))[Symbol.asyncIterator]();

    const first = iterator.next(); // engine starts, attaches listeners
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Teil' } } });
    const firstEvent = await first;
    expect(firstEvent.value).toMatchObject({ type: 'text-delta' });

    await backend.interrupt();
    expect(child.killSignals).toContain('SIGTERM');

    child.emitClose(null, 'SIGTERM'); // process ends because of the signal
    const rest: AgentEvent[] = [];
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) break;
      rest.push(value);
    }
    expect(lastComplete(rest).stopReason).toBe('interrupted');
  });

  it('interrupt() escalates to SIGKILL after the grace period', async () => {
    const { child, spawn } = controllableSpawn();
    const backend = createClaudeCliBackend({ spawn, killGraceMs: 5 });
    const iterator = backend.runTurn(request('Erzähl viel'))[Symbol.asyncIterator]();
    const first = iterator.next();
    child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } });
    await first;

    await backend.interrupt();
    await new Promise((r) => setTimeout(r, 40)); // let the grace period elapse
    expect(child.killSignals).toContain('SIGKILL');

    child.emitClose(null, 'SIGKILL');
    await iterator.next(); // finish the generator cleanly
  });
});

/* ------------------------------------------------------------------ */
/* codex                                                              */
/* ------------------------------------------------------------------ */

describe('codex adapter', () => {
  const transcript = [
    { type: 'thread.started', thread_id: 'th-1' },
    { type: 'turn.started' },
    'kaputt', // skip
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls -la' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls -la', status: 'completed' } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Fertig gebaut.' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
  ];

  it('maps thread/item/turn events (agent_message → text, command → tool-activity)', async () => {
    const { spawn, calls } = scriptedSpawn(transcript);
    const backend = createCodexBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: true, partialText: false, cost: false });

    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    expect(calls[0]?.command).toBe('codex');
    expect(calls[0]?.args).toEqual(['exec', '--json', 'Bau eine Seite']);
    expect(calls[0]?.cwd).toBe(siteDir);

    expect(textOf(events)).toBe('Fertig gebaut.');
    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Shell command' && e.phase === 'start' && e.detail === 'ls -la')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Shell command' && e.phase === 'end')).toBe(true);

    const complete = lastComplete(events);
    expect(complete.stopReason).toBe('end');
    expect(complete.sessionId).toBe('th-1');
    expect(complete.costUsd).toBeUndefined();
  });

  it('uses `exec resume <id>` when a sessionId is present', () => {
    const { spawn, calls } = scriptedSpawn([]);
    const backend = createCodexBackend({ spawn });
    void collect(backend.runTurn(request('weiter', 'th-9')));
    expect(calls[0]?.args).toEqual(['exec', 'resume', 'th-9', '--json', 'weiter']);
  });

  it('turn.failed → error event + stopReason error', async () => {
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

  it('ENOENT → error event with install hint', async () => {
    const { spawn } = enoentSpawn();
    const events = await collect(createCodexBackend({ spawn }).runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.message).toContain('Codex CLI not found');
    expect(error?.type === 'error' && error.message).toContain('https://developers.openai.com');
  });
});

/* ------------------------------------------------------------------ */
/* gemini-cli                                                          */
/* ------------------------------------------------------------------ */

describe('gemini-cli adapter', () => {
  const transcript = [
    { type: 'init', session_id: 'g-sess', model: 'gemini-2.5-pro' },
    { type: 'message', role: 'assistant', content: 'Ich baue ', delta: true },
    'kaputte zeile',
    { type: 'message', role: 'assistant', content: 'die Seite.', delta: true },
    { type: 'tool_use', tool_name: 'WriteFile', tool_id: 't1', parameters: { file_path: 'index.html' } },
    { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 20, output_tokens: 8 } },
  ];

  it('maps init/message/tool_use/tool_result/result onto AgentEvents', async () => {
    const { spawn, calls } = scriptedSpawn(transcript);
    const backend = createGeminiCliBackend({ spawn });
    expect(backend.capabilities()).toEqual({ resume: false, partialText: true, cost: false });

    const events = await collect(backend.runTurn(request('Bau eine Seite')));
    expect(calls[0]?.command).toBe('gemini');
    expect(calls[0]?.args).toEqual(['--output-format', 'stream-json', '--approval-mode', 'auto_edit', '-p', 'Bau eine Seite']);

    expect(textOf(events)).toBe('Ich baue die Seite.');
    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Write file' && e.phase === 'start' && e.detail === 'index.html')).toBe(true);
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'end')).toBe(true);

    expect(lastComplete(events).stopReason).toBe('end');
  });

  it('ENOENT → error event with install hint (google.dev)', async () => {
    const { spawn } = enoentSpawn();
    const events = await collect(createGeminiCliBackend({ spawn }).runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.message).toContain('Gemini CLI not found');
    expect(error?.type === 'error' && error.message).toContain('https://ai.google.dev');
  });

  it('non-null exit code → error event', async () => {
    const { spawn } = scriptedSpawn([{ type: 'init', session_id: 'g' }], { exitCode: 1 });
    const events = await collect(createGeminiCliBackend({ spawn }).runTurn(request('x')));
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(lastComplete(events).stopReason).toBe('error');
  });
});

/* ------------------------------------------------------------------ */
/* grok-cli (experimental)                                            */
/* ------------------------------------------------------------------ */

describe('grok-cli adapter (experimental)', () => {
  const transcript = [
    { method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Baue ' } } } },
    'kaputt {',
    { method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'jetzt.' } } } },
    { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Datei schreiben', status: 'pending' } } },
    { method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed' } } },
    { type: 'result' },
  ];

  it('tolerantly maps ACP session/update chunks onto AgentEvents', async () => {
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

  it('ENOENT → error event with install hint (experimental, x.ai)', async () => {
    const { spawn } = enoentSpawn();
    const events = await collect(createGrokCliBackend({ spawn }).runTurn(request('x')));
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.message).toContain('Grok Build CLI not found');
    expect(error?.type === 'error' && error.message).toContain('https://docs.x.ai');
    expect(error?.type === 'error' && error.message).toContain('experimental');
  });
});
