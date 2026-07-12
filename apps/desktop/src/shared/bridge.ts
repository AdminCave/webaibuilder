/**
 * Desktop-Erweiterung der Preload-Bridge (`window.wab`).
 *
 * Der eingefrorene Basis-Vertrag `WabBridge` (ping, projects, templates) lebt in
 * @webaibuilder/core und darf nicht geändert werden. Diese Datei ergänzt die
 * M2-Oberfläche (session, chat, checkpoints, settings, Event-Abos) als eigenen,
 * additiven Vertrag. Preload stellt `WabBridge & WabDesktopBridge` unter
 * `window.wab` bereit (siehe preload/index.ts, env.d.ts).
 *
 * Da `BRIDGE_VERSION` in core eingefroren ist, versioniert apps/desktop seine
 * additive Oberfläche mit einer eigenen Konstante.
 *
 * Umgebungsneutral (kein node/electron/DOM).
 */

import type { Checkpoint, PermissionDecision } from '@webaibuilder/core';

import type {
  AgentEventMessage,
  ChatSendResult,
  CheckpointsMessage,
  PreviewEventMessage,
  SessionInfo,
} from './channels';
import type { AgentSettings, AgentSettingsInput } from './settings';

export const WAB_DESKTOP_BRIDGE_VERSION = 1;

/** Meldet ein Push-Abo wieder ab. */
export type Unsubscribe = () => void;

export interface WabDesktopBridge {
  readonly desktopVersion: typeof WAB_DESKTOP_BRIDGE_VERSION;

  session: {
    /** Öffnet ein Projekt: Workspace init + Preview-Start; liefert URL + Checkpoints. */
    open(projectId: string): Promise<SessionInfo>;
    /** Schließt das aktive Projekt (Preview stoppen, Turn abbrechen). */
    close(): Promise<void>;
  };

  chat: {
    /** Startet einen Turn mit vorab erzeugter Lauf-ID; Events kommen über `onAgentEvent`. */
    send(prompt: string, runId: string): Promise<ChatSendResult>;
    /** Bricht den laufenden Turn ab (Stopp). */
    interrupt(): Promise<void>;
    /** Beantwortet eine Permission-Anfrage. */
    respondPermission(decision: PermissionDecision): Promise<void>;
  };

  checkpoints: {
    list(): Promise<Checkpoint[]>;
    /** Stellt einen Checkpoint als neuen Commit wieder her. */
    restore(checkpointId: string): Promise<Checkpoint>;
  };

  settings: {
    get(): Promise<AgentSettings>;
    set(input: AgentSettingsInput): Promise<AgentSettings>;
  };

  events: {
    onAgentEvent(listener: (message: AgentEventMessage) => void): Unsubscribe;
    onPreviewEvent(listener: (message: PreviewEventMessage) => void): Unsubscribe;
    onCheckpoints(listener: (message: CheckpointsMessage) => void): Unsubscribe;
  };
}
