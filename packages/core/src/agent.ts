/**
 * Agent adapter contract: one interface, six backends (PLAN §4).
 *
 * File changes are NOT part of the event stream — ground truth is the
 * chokidar watcher in packages/preview. This keeps all backends behaving
 * identically.
 */

import type { PermissionPolicy, PermissionScope } from './permissions';

/** All planned backends (PLAN §4). */
export type BackendId = 'claude-sdk' | 'claude-cli' | 'codex' | 'gemini-cli' | 'grok-cli' | 'byok';

/** What a backend can do — fed from the init event / capability detection. */
export interface AgentCapabilities {
  /** Can resume a session (session ID across turns). */
  resume: boolean;
  /** Emits partial text deltas during generation. */
  partialText: boolean;
  /** Reports cost per turn (`turn-complete.costUsd`). */
  cost: boolean;
}

/** A user turn for the backend to run. */
export interface AgentTurnRequest {
  /** Absolute path of the workspace (`~/WebAIBuilder/<project>`). */
  workspaceDir: string;
  /** Absolute path of the docroot (`<workspaceDir>/site`) that the AI edits. */
  siteDir: string;
  prompt: string;
  /** Resume the session if `capabilities().resume`. */
  sessionId?: string;
  policy: PermissionPolicy;
}

/** Partial response text during generation. */
export interface TextDeltaEvent {
  type: 'text-delta';
  text: string;
}

export type ToolActivityPhase = 'start' | 'update' | 'end';

/** Backend tool usage — display only, never as file ground truth. */
export interface ToolActivityEvent {
  type: 'tool-activity';
  toolCallId: string;
  /** Display name of the tool, e.g. "Write file". */
  tool: string;
  phase: ToolActivityPhase;
  /** Short description for the UI, e.g. the file path relative to site/. */
  detail?: string;
}

/** The backend requests permission (policy says `prompt`). */
export interface PermissionRequestEvent {
  type: 'permission-request';
  requestId: string;
  scope: PermissionScope;
  /** Human-readable description for the UI. */
  description: string;
  /** Backend-specific raw data (command, path, URL …). */
  payload?: Readonly<Record<string, unknown>>;
}

export type TurnStopReason = 'end' | 'interrupted' | 'error';

/** Completion of a turn — basis for the checkpoint (packages/versioning). */
export interface TurnCompleteEvent {
  type: 'turn-complete';
  turnId: string;
  stopReason: TurnStopReason;
  /** Session ID for resuming, if the backend supports `resume`. */
  sessionId?: string;
  /** Cost in USD, if the backend supports `cost`. */
  costUsd?: number;
}

export interface AgentErrorEvent {
  type: 'error';
  message: string;
  /** true = the turn can be retried, the session stays usable. */
  recoverable: boolean;
  cause?: string;
}

/**
 * The event stream of a turn:
 * text-delta | tool-activity | permission-request | turn-complete | error
 */
export type AgentEvent =
  | TextDeltaEvent
  | ToolActivityEvent
  | PermissionRequestEvent
  | TurnCompleteEvent
  | AgentErrorEvent;

/** The single adapter contract for all six backends (PLAN §4). */
export interface AgentBackend {
  readonly id: BackendId;
  capabilities(): AgentCapabilities;
  runTurn(req: AgentTurnRequest): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
}
