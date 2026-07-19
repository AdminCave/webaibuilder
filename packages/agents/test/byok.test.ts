/**
 * Tests for the byok adapter with a fake model (AI SDK mock).
 * No live API key required.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentEvent, AgentTurnRequest } from '@webaibuilder/core';
import { DEFAULT_PERMISSION_POLICY } from '@webaibuilder/core';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createByokBackend } from '../src/byok';
import { createSiteTools } from '../src/tools';

// --- Mock helpers: valid LanguageModelV4 stream parts ---------------------

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 8, reasoning: 0 },
};

function finishPart(reason: string): unknown {
  return { type: 'finish', usage: USAGE, finishReason: { unified: reason, raw: reason } };
}

function textParts(id: string, text: string): unknown[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id },
    { type: 'text-delta', id, delta: text },
    { type: 'text-end', id },
  ];
}

function toolCallPart(toolCallId: string, toolName: string, input: unknown): unknown {
  return { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) };
}

function mockModel(steps: unknown[][], chunkDelayInMs: number | null = null): LanguageModel {
  const model = new MockLanguageModelV4({
    doStream: steps.map((parts) => ({
      stream: simulateReadableStream({
        chunks: parts as never[],
        initialDelayInMs: null,
        chunkDelayInMs,
      }),
    })) as never,
  });
  return model as unknown as LanguageModel;
}

// --- Fixtures --------------------------------------------------------------

let workspaceDir: string;
let siteDir: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'wab-byok-'));
  siteDir = join(workspaceDir, 'site');
  await mkdir(siteDir, { recursive: true });
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

function request(prompt: string): AgentTurnRequest {
  return { workspaceDir, siteDir, prompt, policy: DEFAULT_PERMISSION_POLICY };
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}

// --- Tests -----------------------------------------------------------------

describe('byok adapter (event mapping)', () => {
  it('maps text-delta, tool-activity and turn-complete and writes into site/', async () => {
    const model = mockModel([
      [
        ...textParts('0', 'Ich baue die Startseite.'),
        toolCallPart('c1', 'write_file', { path: 'index.html', content: '<h1>Hallo</h1>' }),
        finishPart('tool-calls'),
      ],
      [...textParts('1', 'Fertig.'), finishPart('stop')],
    ]);
    const backend = createByokBackend({ provider: 'anthropic', apiKey: '', languageModel: model });

    const events = await collect(backend.runTurn(request('Bau mir eine Startseite')));

    const textDeltas = events.filter((e) => e.type === 'text-delta');
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas.map((e) => (e.type === 'text-delta' ? e.text : '')).join('')).toContain('Startseite');

    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.tool === 'Write file')).toBe(true);
    const startActivity = activity.find((e) => e.type === 'tool-activity' && e.phase === 'start');
    expect(startActivity && startActivity.type === 'tool-activity' ? startActivity.detail : undefined).toBe(
      'site/index.html',
    );

    const complete = events.at(-1);
    expect(complete?.type).toBe('turn-complete');
    expect(complete && complete.type === 'turn-complete' ? complete.stopReason : undefined).toBe('end');

    // The file really landed in site/ (ground truth: the file system).
    const written = await readFile(join(siteDir, 'index.html'), 'utf8');
    expect(written).toBe('<h1>Hallo</h1>');
  });

  it('CRITICAL: denies write access outside of site/ (containment)', async () => {
    const model = mockModel([
      [
        toolCallPart('c1', 'write_file', { path: '../evil.html', content: 'pwned' }),
        finishPart('tool-calls'),
      ],
      [...textParts('1', 'ok'), finishPart('stop')],
    ]);
    const backend = createByokBackend({ provider: 'anthropic', apiKey: '', languageModel: model });

    const events = await collect(backend.runTurn(request('Schreib außerhalb')));

    // The file must NOT exist outside of site/.
    expect(existsSync(join(workspaceDir, 'evil.html'))).toBe(false);
    expect(existsSync(join(siteDir, '..', 'evil.html'))).toBe(false);
    // The turn still finishes cleanly.
    expect(events.at(-1)?.type).toBe('turn-complete');
  });

  it('interrupt() aborts the running turn', async () => {
    const manyDeltas: unknown[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: '0' },
    ];
    for (let i = 0; i < 12; i += 1) manyDeltas.push({ type: 'text-delta', id: '0', delta: `Teil ${i} ` });
    manyDeltas.push({ type: 'text-end', id: '0' });
    manyDeltas.push(finishPart('stop'));

    const model = mockModel([manyDeltas], 25);
    const backend = createByokBackend({ provider: 'anthropic', apiKey: '', languageModel: model });

    const iterator = backend.runTurn(request('Erzähl viel'))[Symbol.asyncIterator]();
    const collected: AgentEvent[] = [];
    let didInterrupt = false;
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) break;
      collected.push(value);
      if (value.type === 'text-delta' && !didInterrupt) {
        didInterrupt = true;
        await backend.interrupt();
      }
    }

    const complete = collected.at(-1);
    expect(complete?.type).toBe('turn-complete');
    expect(complete && complete.type === 'turn-complete' ? complete.stopReason : undefined).toBe(
      'interrupted',
    );
    // Not all 12 deltas may have made it through.
    expect(collected.filter((e) => e.type === 'text-delta').length).toBeLessThan(12);
  });
});

describe('byok tools (direct containment)', () => {
  type ExecFn = (input: unknown, options: unknown) => Promise<unknown>;
  function execOf(name: string): ExecFn {
    const tools = createSiteTools(siteDir) as Record<string, { execute?: ExecFn }>;
    const fn = tools[name]?.execute;
    if (!fn) throw new Error(`Tool ${name} has no execute`);
    return fn;
  }

  it('write_file denies paths outside of site/ and writes nothing', async () => {
    const result = (await execOf('write_file')(
      { path: '../escape.html', content: 'x' },
      { toolCallId: 't', messages: [] },
    )) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('site/');
    expect(existsSync(join(workspaceDir, 'escape.html'))).toBe(false);
  });

  it('write_file + read_file work within site/', async () => {
    const opts = { toolCallId: 't', messages: [] };
    await execOf('write_file')({ path: 'sub/page.html', content: 'hi' }, opts);
    expect(await readFile(join(siteDir, 'sub', 'page.html'), 'utf8')).toBe('hi');

    const read = (await execOf('read_file')({ path: 'sub/page.html' }, opts)) as {
      ok: boolean;
      content?: string;
    };
    expect(read.ok).toBe(true);
    expect(read.content).toBe('hi');
  });
});
