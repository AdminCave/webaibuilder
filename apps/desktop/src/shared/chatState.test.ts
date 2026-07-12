import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '@webaibuilder/core';

import {
  chatReducer,
  initialChatState,
  type AssistantMessage,
  type ChatState,
} from './chatState';

const RUN = 'run-1';

function withRun(): ChatState {
  return chatReducer(initialChatState, { type: 'user-send', runId: RUN, text: 'Bau eine Landingpage' });
}

function agent(state: ChatState, event: AgentEvent, runId = RUN): ChatState {
  return chatReducer(state, { type: 'agent-event', runId, event });
}

function assistant(state: ChatState): AssistantMessage {
  const message = state.messages.find((m) => m.role === 'assistant' && m.id === RUN);
  if (message === undefined || message.role !== 'assistant') throw new Error('kein Assistent');
  return message;
}

describe('chatReducer', () => {
  it('user-send legt Nutzer- und Assistenten-Nachricht an und startet den Turn', () => {
    const state = withRun();
    expect(state.status).toBe('running');
    expect(state.runId).toBe(RUN);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'user', text: 'Bau eine Landingpage' });
    expect(assistant(state)).toMatchObject({ role: 'assistant', text: '', status: 'streaming' });
  });

  it('setzt text-delta-Events zum Antworttext zusammen', () => {
    let state = withRun();
    state = agent(state, { type: 'text-delta', text: 'Hallo ' });
    state = agent(state, { type: 'text-delta', text: 'Welt' });
    expect(assistant(state).text).toBe('Hallo Welt');
  });

  it('führt Tool-Aktivität über start/update/end als einen Chip', () => {
    let state = withRun();
    state = agent(state, {
      type: 'tool-activity',
      toolCallId: 't1',
      tool: 'Datei schreiben',
      phase: 'start',
      detail: 'index.html',
    });
    expect(assistant(state).tools).toEqual([
      { toolCallId: 't1', tool: 'Datei schreiben', detail: 'index.html', done: false },
    ]);
    state = agent(state, { type: 'tool-activity', toolCallId: 't1', tool: 'Datei schreiben', phase: 'end' });
    expect(assistant(state).tools).toHaveLength(1);
    expect(assistant(state).tools[0]).toMatchObject({ done: true, detail: 'index.html' });
  });

  it('führt den Permission-Round-Trip: request setzt, answered räumt', () => {
    let state = withRun();
    state = agent(state, {
      type: 'permission-request',
      requestId: 'p1',
      scope: 'shell',
      description: 'Darf ich npm install ausführen?',
    });
    expect(state.pendingPermission).toMatchObject({ requestId: 'p1', scope: 'shell' });
    state = chatReducer(state, { type: 'permission-answered', requestId: 'p1' });
    expect(state.pendingPermission).toBeNull();
  });

  it('turn-complete beendet den Turn und übernimmt die Kosten', () => {
    let state = withRun();
    state = agent(state, { type: 'text-delta', text: 'fertig' });
    state = agent(state, { type: 'turn-complete', turnId: 't', stopReason: 'end', costUsd: 0.012 });
    expect(state.status).toBe('idle');
    expect(state.runId).toBeNull();
    expect(assistant(state)).toMatchObject({ status: 'complete', costUsd: 0.012 });
  });

  it('markiert Abbruch über turn-complete(interrupted)', () => {
    let state = withRun();
    state = agent(state, { type: 'turn-complete', turnId: 't', stopReason: 'interrupted' });
    expect(assistant(state).status).toBe('interrupted');
    expect(state.status).toBe('idle');
  });

  it('markiert Fehler und behält ihn über den Abschluss hinweg', () => {
    let state = withRun();
    state = agent(state, { type: 'error', message: 'Kein Guthaben', recoverable: false });
    expect(assistant(state)).toMatchObject({ status: 'error', errorText: 'Kein Guthaben' });
    state = agent(state, { type: 'turn-complete', turnId: 't', stopReason: 'error' });
    expect(assistant(state).status).toBe('error');
    expect(assistant(state).errorText).toBe('Kein Guthaben');
    expect(state.status).toBe('idle');
  });

  it('ignoriert Events eines fremden (veralteten) Turns', () => {
    let state = withRun();
    state = agent(state, { type: 'text-delta', text: 'X' }, 'anderer-run');
    expect(assistant(state).text).toBe('');
  });

  it('reset stellt den Anfangszustand her', () => {
    const state = chatReducer(withRun(), { type: 'reset' });
    expect(state).toEqual(initialChatState);
  });
});
