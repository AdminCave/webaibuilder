/**
 * Tests für den claude-sdk-Adapter.
 *
 * Es läuft KEIN Live-`query()` (das würde einen Claude-Code-Subprozess + Key
 * starten). Stattdessen wird `@anthropic-ai/claude-agent-sdk` gemockt und ein
 * gefälschter Nachrichten-Strom durchgereicht, um das Event-Mapping zu prüfen.
 * Zusätzlich: reine Unit-Tests für Policy-/Scope-Mapping und die Factory.
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentEvent, AgentTurnRequest } from '@webaibuilder/core';
import { DEFAULT_PERMISSION_POLICY } from '@webaibuilder/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Den Vendor-SDK mocken, bevor der Adapter ihn importiert.
const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { createByokBackend } from '../src/byok';
import { classifyTool, createClaudeSdkBackend, mapPermissionMode } from '../src/claudeSdk';
import { createBackend, detectBackends } from '../src/index';

let workspaceDir: string;
let siteDir: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'wab-claude-'));
  siteDir = join(workspaceDir, 'site');
  await mkdir(siteDir, { recursive: true });
  queryMock.mockReset();
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

describe('claude-sdk-Adapter (Message-Mapping, gemockt)', () => {
  it('mappt system/stream_event/assistant/user/result auf AgentEvents', async () => {
    async function* fakeMessages() {
      yield { type: 'system', subtype: 'init', session_id: 'sess-1', uuid: 'u0' };
      yield {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hallo ' } },
        uuid: 'u1',
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'index.html' } }] },
        uuid: 'u2',
      };
      yield {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] },
        uuid: 'u3',
      };
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.0123,
        session_id: 'sess-1',
        uuid: 'u4',
      };
    }
    queryMock.mockReturnValue(fakeMessages());

    const backend = createClaudeSdkBackend({ apiKey: 'test-key' });
    const events = await collect(backend.runTurn(request('Bau eine Seite')));

    // query() wurde mit cwd = siteDir und acceptEdits aufgerufen.
    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0]?.[0] as { prompt: string; options: Record<string, unknown> };
    expect(call.options.cwd).toBe(siteDir);
    expect(call.options.permissionMode).toBe('acceptEdits');
    const env = call.options.env as Record<string, string> | undefined;
    expect(env?.ANTHROPIC_API_KEY).toBe('test-key');

    const text = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e.type === 'text-delta' ? e.text : ''))
      .join('');
    expect(text).toContain('Hallo');

    const activity = events.filter((e) => e.type === 'tool-activity');
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'start' && e.tool === 'Datei schreiben')).toBe(
      true,
    );
    expect(activity.some((e) => e.type === 'tool-activity' && e.phase === 'end')).toBe(true);

    const complete = events.at(-1);
    expect(complete?.type).toBe('turn-complete');
    if (complete?.type === 'turn-complete') {
      expect(complete.stopReason).toBe('end');
      expect(complete.sessionId).toBe('sess-1');
      expect(complete.costUsd).toBeCloseTo(0.0123);
    }
  });
});

describe('claude-sdk-Adapter (Policy-/Scope-Mapping)', () => {
  it('mapPermissionMode: Auto-Approve von Edits → acceptEdits', () => {
    expect(mapPermissionMode(DEFAULT_PERMISSION_POLICY)).toBe('acceptEdits');
    expect(mapPermissionMode({ ...DEFAULT_PERMISSION_POLICY, 'edit-in-site': 'prompt' })).toBe('default');
  });

  it('classifyTool ordnet Tools den richtigen Scopes zu', async () => {
    expect(await classifyTool('Write', { file_path: 'index.html' }, siteDir)).toBe('edit-in-site');
    expect(await classifyTool('Edit', { file_path: '../../etc/passwd' }, siteDir)).toBe('edit-outside-site');
    expect(await classifyTool('Read', { file_path: 'index.html' }, siteDir)).toBe('read');
    expect(await classifyTool('Bash', { command: 'ls' }, siteDir)).toBe('shell');
    expect(await classifyTool('WebFetch', { url: 'https://x' }, siteDir)).toBe('network');
  });
});

describe('Factory & Detection', () => {
  it('createBackend erzeugt byok und claude-sdk', () => {
    const byok = createBackend('byok', { apiKey: 'k' });
    expect(byok.id).toBe('byok');
    expect(byok.capabilities()).toEqual({ resume: false, partialText: true, cost: false });

    const claude = createBackend('claude-sdk', { apiKey: 'k' });
    expect(claude.id).toBe('claude-sdk');
    expect(claude.capabilities()).toEqual({ resume: true, partialText: true, cost: true });
  });

  it('createBackend erzeugt die vier M4-CLI-Backends; byok ohne Key wirft', () => {
    expect(createBackend('claude-cli', {}).id).toBe('claude-cli');
    expect(createBackend('codex', {}).id).toBe('codex');
    expect(createBackend('gemini-cli', {}).id).toBe('gemini-cli');
    expect(createBackend('grok-cli', {}).id).toBe('grok-cli');
    expect(createBackend('gemini-cli', {}).capabilities()).toEqual({
      resume: false,
      partialText: true,
      cost: false,
    });
    expect(() => createBackend('byok', {})).toThrow(/API-Key/);
  });

  it('detectBackends meldet byok verfügbar, CLIs ohne Installation nicht', async () => {
    // Injizierter which-Fake: nichts installiert (kein echter PATH-/CLI-Zugriff).
    const list = await detectBackends({ which: async () => null, keyEnv: {} });
    const byId = Object.fromEntries(list.map((b) => [b.id, b]));
    expect(byId.byok?.installed).toBe(true);
    expect(byId['gemini-cli']?.installed).toBe(false);
    expect(byId.codex?.installed).toBe(false);
    expect(byId['claude-sdk']).toBeDefined();
  });

  it('byok-Adapter ist direkt konstruierbar (createByokBackend)', () => {
    const backend = createByokBackend({ provider: 'openai', apiKey: 'k' });
    expect(backend.id).toBe('byok');
  });
});
