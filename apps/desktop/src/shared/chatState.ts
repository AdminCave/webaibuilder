/**
 * Reiner Reducer: AgentEvent-Strom + Nutzeraktionen → Chat-UI-Zustand.
 *
 * Bewusst frei von React/DOM/node, damit die Kern-Logik (Streaming-Text,
 * Tool-Chips, Permission-Prompt, Turn-Abschluss) headless mit vitest getestet
 * werden kann. Die React-Komponente hält diesen Zustand nur noch.
 */

import type { AgentEvent, PermissionScope } from '@webaibuilder/core';

/** Eine Tool-Aktivität des Backends — nur Anzeige (PLAN §4). */
export interface ToolActivity {
  toolCallId: string;
  /** Anzeigename, z. B. „Datei schreiben". */
  tool: string;
  /** Detail, z. B. Pfad relativ zu site/. */
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
  /** Zusammengesetzter Text aus den text-delta-Events. */
  text: string;
  tools: ToolActivity[];
  status: AssistantStatus;
  /** Fehlermeldung bei status === 'error'. */
  errorText?: string;
  /** Kosten in USD, falls das Backend sie meldet. */
  costUsd?: number;
}

export type ChatMessage = UserMessage | AssistantMessage;

/** Offene Permission-Anfrage, die der Nutzer beantworten muss. */
export interface PendingPermission {
  requestId: string;
  scope: PermissionScope;
  /** Deutscher, menschenlesbarer Text (Du-Form). */
  description: string;
}

export interface ChatState {
  messages: ChatMessage[];
  status: 'idle' | 'running';
  pendingPermission: PendingPermission | null;
  /** Lauf-ID des aktiven Turns (korreliert Push-Events). */
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
          // Ein schon gesetzter Fehler (error-Event) bleibt erhalten.
          status: m.status === 'error' ? 'error' : status,
          ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        })),
      };
    }

    case 'error':
      return {
        ...state,
        // Bei recoverable bleibt der Turn technisch offen, bis turn-complete
        // kommt; sonst gilt er als beendet.
        status: event.recoverable ? state.status : 'idle',
        pendingPermission: null,
        messages: mapAssistant(state.messages, runId, (m) => ({
          ...m,
          status: 'error',
          errorText: event.message,
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
      // Veraltete Events eines abgeschlossenen Turns ignorieren.
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
