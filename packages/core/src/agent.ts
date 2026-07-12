/**
 * Agent-Adapter-Vertrag: ein Interface, sechs Backends (PLAN §4).
 *
 * Datei-Änderungen sind NICHT Teil des Event-Stroms — ground truth ist der
 * chokidar-Watcher in packages/preview. Dadurch verhalten sich alle Backends
 * identisch.
 */

import type { PermissionPolicy, PermissionScope } from './permissions';

/** Alle geplanten Backends (PLAN §4). */
export type BackendId = 'claude-sdk' | 'claude-cli' | 'codex' | 'gemini-cli' | 'grok-cli' | 'byok';

/** Was ein Backend kann — gespeist aus Init-Event/Capability-Detection. */
export interface AgentCapabilities {
  /** Kann eine Session fortsetzen (Session-ID über Turns hinweg). */
  resume: boolean;
  /** Liefert partielle Text-Deltas während der Generierung. */
  partialText: boolean;
  /** Meldet Kosten pro Turn (`turn-complete.costUsd`). */
  cost: boolean;
}

/** Ein Nutzer-Turn, den das Backend ausführen soll. */
export interface AgentTurnRequest {
  /** Absoluter Pfad des Workspace (`~/WebAIBuilder/<projekt>`). */
  workspaceDir: string;
  /** Absoluter Pfad des Docroot (`<workspaceDir>/site`), das die KI editiert. */
  siteDir: string;
  prompt: string;
  /** Session fortsetzen, falls `capabilities().resume`. */
  sessionId?: string;
  policy: PermissionPolicy;
}

/** Partieller Antworttext während der Generierung. */
export interface TextDeltaEvent {
  type: 'text-delta';
  text: string;
}

export type ToolActivityPhase = 'start' | 'update' | 'end';

/** Tool-Nutzung des Backends — nur zur Anzeige, nie als Datei-Ground-Truth. */
export interface ToolActivityEvent {
  type: 'tool-activity';
  toolCallId: string;
  /** Anzeigename des Tools, z. B. "Datei schreiben". */
  tool: string;
  phase: ToolActivityPhase;
  /** Kurzbeschreibung fürs UI, z. B. der Dateipfad relativ zu site/. */
  detail?: string;
}

/** Das Backend bittet um Erlaubnis (Policy sagt `prompt`). */
export interface PermissionRequestEvent {
  type: 'permission-request';
  requestId: string;
  scope: PermissionScope;
  /** Menschlich lesbare Beschreibung fürs UI (deutsch, Du-Form). */
  description: string;
  /** Backend-spezifische Rohdaten (Kommando, Pfad, URL …). */
  payload?: Readonly<Record<string, unknown>>;
}

export type TurnStopReason = 'end' | 'interrupted' | 'error';

/** Abschluss eines Turns — Basis für den Checkpoint (packages/versioning). */
export interface TurnCompleteEvent {
  type: 'turn-complete';
  turnId: string;
  stopReason: TurnStopReason;
  /** Session-ID zum Fortsetzen, falls das Backend `resume` kann. */
  sessionId?: string;
  /** Kosten in USD, falls das Backend `cost` kann. */
  costUsd?: number;
}

export interface AgentErrorEvent {
  type: 'error';
  message: string;
  /** true = Turn kann erneut versucht werden, Session bleibt nutzbar. */
  recoverable: boolean;
  cause?: string;
}

/**
 * Der Event-Strom eines Turns:
 * text-delta | tool-activity | permission-request | turn-complete | error
 */
export type AgentEvent =
  | TextDeltaEvent
  | ToolActivityEvent
  | PermissionRequestEvent
  | TurnCompleteEvent
  | AgentErrorEvent;

/** Der eine Adapter-Vertrag für alle sechs Backends (PLAN §4). */
export interface AgentBackend {
  readonly id: BackendId;
  capabilities(): AgentCapabilities;
  runTurn(req: AgentTurnRequest): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
}
