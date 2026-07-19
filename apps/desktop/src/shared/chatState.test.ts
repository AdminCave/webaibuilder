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
  return chatReducer(initialChatState, { type: 'user-send', runId: RUN, text: 'Build a landing page' });
}

function agent(state: ChatState, event: AgentEvent, runId = RUN): ChatState {
  return chatReducer(state, { type: 'agent-event', runId, event });
}

function assistant(state: ChatState): AssistantMessage {
  const message = state.messages.find((m) => m.role === 'assistant' && m.id === RUN);
  if (message === undefined || message.role !== 'assistant') throw new Error('no assistant');
  return message;
}

describe('chatReducer', () => {
  it('user-send creates the user and assistant message and starts the turn', () => {
    const state = withRun();
    expect(state.status).toBe('running');
    expect(state.runId).toBe(RUN);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'user', text: 'Build a landing page' });
    expect(assistant(state)).toMatchObject({ role: 'assistant', text: '', status: 'streaming' });
  });

  it('assembles text-delta events into the reply text', () => {
    let state = withRun();
    state = agent(state, { type: 'text-delta', text: 'Hello ' });
    state = agent(state, { type: 'text-delta', text: 'World' });
    expect(assistant(state).text).toBe('Hello World');
  });

  it('tracks tool activity across start/update/end as a single chip', () => {
    let state = withRun();
    state = agent(state, {
      type: 'tool-activity',
      toolCallId: 't1',
      tool: 'Write file',
      phase: 'start',
      detail: 'index.html',
    });
    expect(assistant(state).tools).toEqual([
      { toolCallId: 't1', tool: 'Write file', detail: 'index.html', done: false },
    ]);
    state = agent(state, { type: 'tool-activity', toolCallId: 't1', tool: 'Write file', phase: 'end' });
    expect(assistant(state).tools).toHaveLength(1);
    expect(assistant(state).tools[0]).toMatchObject({ done: true, detail: 'index.html' });
  });

  it('runs the permission round-trip: request sets, answered clears', () => {
    let state = withRun();
    state = agent(state, {
      type: 'permission-request',
      requestId: 'p1',
      scope: 'shell',
      description: 'May I run npm install?',
    });
    expect(state.pendingPermission).toMatchObject({ requestId: 'p1', scope: 'shell' });
    state = chatReducer(state, { type: 'permission-answered', requestId: 'p1' });
    expect(state.pendingPermission).toBeNull();
  });

  it('turn-complete ends the turn and adopts the cost', () => {
    let state = withRun();
    state = agent(state, { type: 'text-delta', text: 'done' });
    state = agent(state, { type: 'turn-complete', turnId: 't', stopReason: 'end', costUsd: 0.012 });
    expect(state.status).toBe('idle');
    expect(state.runId).toBeNull();
    expect(assistant(state)).toMatchObject({ status: 'complete', costUsd: 0.012 });
  });

  it('marks an abort via turn-complete(interrupted)', () => {
    let state = withRun();
    state = agent(state, { type: 'turn-complete', turnId: 't', stopReason: 'interrupted' });
    expect(assistant(state).status).toBe('interrupted');
    expect(state.status).toBe('idle');
  });

  it('marks an error and keeps it across completion', () => {
    let state = withRun();
    state = agent(state, { type: 'error', message: 'Out of credit', recoverable: false });
    expect(assistant(state)).toMatchObject({ status: 'error', errorText: 'Out of credit' });
    state = agent(state, { type: 'turn-complete', turnId: 't', stopReason: 'error' });
    expect(assistant(state).status).toBe('error');
    expect(assistant(state).errorText).toBe('Out of credit');
    expect(state.status).toBe('idle');
  });

  it('ignores events from a foreign (stale) turn', () => {
    let state = withRun();
    state = agent(state, { type: 'text-delta', text: 'X' }, 'other-run');
    expect(assistant(state).text).toBe('');
  });

  it('reset restores the initial state', () => {
    const state = chatReducer(withRun(), { type: 'reset' });
    expect(state).toEqual(initialChatState);
  });
});

describe('chatReducer — error cause (errorCause)', () => {
  it('adopts the cause from the error event into the assistant message', () => {
    let state = withRun();
    state = agent(state, {
      type: 'error',
      message: 'The Claude turn could not be completed.',
      recoverable: false,
      cause: '401 {"type":"authentication_error"}',
    });
    expect(assistant(state)).toMatchObject({
      status: 'error',
      errorText: 'The Claude turn could not be completed.',
      errorCause: '401 {"type":"authentication_error"}',
    });
  });

  it('omits errorCause when the event carries no cause', () => {
    let state = withRun();
    state = agent(state, { type: 'error', message: 'Error', recoverable: false });
    expect(assistant(state).errorCause).toBeUndefined();
  });
});
