/**
 * Pure reducer: AgentEvent stream + user actions → chat UI state.
 *
 * Deliberately free of React/DOM/node so the core logic (streaming text, tool
 * chips, permission prompt, turn completion) can be tested headlessly with
 * vitest. The React component only holds this state now.
 */

import type { AgentEvent, PermissionScope } from '@webaibuilder/core';

/** A tool activity of the backend — display only (PLAN §4). */
export interface ToolActivity {
  toolCallId: string;
  /** Display name, e.g. "Write file". */
  tool: string;
  /** Detail, e.g. path relative to site/. */
  detail?: string;
  done: boolean;
}

export type AssistantStatus = 'streaming' | 'complete' | 'interrupted' | 'error';

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  /** Text assembled from the text-delta events. */
  text: string;
  tools: ToolActivity[];
  status: AssistantStatus;
  /** Error message when status === 'error'. */
  errorText?: string;
  /** Technical cause (e.g. a 401 response) — expandable in the UI. */
  errorCause?: string;
  /** Cost in USD, if the backend reports it. */
  costUsd?: number;
}

export type ChatMessage = UserMessage | AssistantMessage;

/** Open permission request that the user must answer. */
export interface PendingPermission {
  requestId: string;
  scope: PermissionScope;
  /** Human-readable description. */
  description: string;
}

export interface ChatState {
  messages: ChatMessage[];
  status: 'idle' | 'running';
  pendingPermission: PendingPermission | null;
  /** Run ID of the active turn (correlates push events). */
  runId: string | null;
}

export const initialChatState: ChatState = {
  messages: [],
  status: 'idle',
  pendingPermission: null,
  runId: null,
};

export type ChatAction =
  | { type: 'user-send'; runId: string; text: string }
  | { type: 'agent-event'; runId: string; event: AgentEvent }
  | { type: 'permission-answered'; requestId: string }
  | { type: 'reset' };

function mapAssistant(
  messages: ChatMessage[],
  runId: string,
  update: (message: AssistantMessage) => AssistantMessage,
): ChatMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.id === runId ? update(message) : message,
  );
}

function applyEvent(state: ChatState, event: AgentEvent): ChatState {
  const runId = state.runId;
  if (runId === null) return state;

  switch (event.type) {
    case 'text-delta':
      return {
        ...state,
        messages: mapAssistant(state.messages, runId, (m) => ({ ...m, text: m.text + event.text })),
      };

    case 'tool-activity':
      return {
        ...state,
        messages: mapAssistant(state.messages, runId, (m) => {
          const tools = [...m.tools];
          const index = tools.findIndex((t) => t.toolCallId === event.toolCallId);
          const detail = event.detail ?? tools[index]?.detail;
          const next: ToolActivity = {
            toolCallId: event.toolCallId,
            tool: event.tool,
            ...(detail !== undefined ? { detail } : {}),
            done: event.phase === 'end',
          };
          if (index === -1) {
            tools.push(next);
          } else {
            tools[index] = next;
          }
          return { ...m, tools };
        }),
      };

    case 'permission-request':
      return {
        ...state,
        pendingPermission: {
          requestId: event.requestId,
          scope: event.scope,
          description: event.description,
        },
      };

    case 'turn-complete': {
      const status: AssistantStatus =
        event.stopReason === 'interrupted'
          ? 'interrupted'
          : event.stopReason === 'error'
            ? 'error'
            : 'complete';
      return {
        ...state,
        status: 'idle',
        runId: null,
        pendingPermission: null,
        messages: mapAssistant(state.messages, runId, (m) => ({
          ...m,
          // An already-set error (error event) is preserved.
          status: m.status === 'error' ? 'error' : status,
          ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        })),
      };
    }

    case 'error':
      return {
        ...state,
        // For recoverable errors the turn stays technically open until
        // turn-complete arrives; otherwise it counts as finished.
        status: event.recoverable ? state.status : 'idle',
        pendingPermission: null,
        messages: mapAssistant(state.messages, runId, (m) => ({
          ...m,
          status: 'error',
          errorText: event.message,
          // Don't throw away the real cause (401, invalid model, …) anymore —
          // the UI shows it in an expandable section.
          ...(event.cause !== undefined ? { errorCause: event.cause } : {}),
        })),
      };

    default:
      return state;
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'user-send': {
      const user: UserMessage = { id: `${action.runId}:user`, role: 'user', text: action.text };
      const assistant: AssistantMessage = {
        id: action.runId,
        role: 'assistant',
        text: '',
        tools: [],
        status: 'streaming',
      };
      return {
        ...state,
        status: 'running',
        runId: action.runId,
        pendingPermission: null,
        messages: [...state.messages, user, assistant],
      };
    }

    case 'agent-event':
      // Ignore stale events from a completed turn.
      if (action.runId !== state.runId) return state;
      return applyEvent(state, action.event);

    case 'permission-answered':
      if (state.pendingPermission?.requestId !== action.requestId) return state;
      return { ...state, pendingPermission: null };

    case 'reset':
      return initialChatState;

    default:
      return state;
  }
}
