/**
 * Desktop-lokale IPC-Kanal-Registry für die M2-Features (Chat, Preview,
 * Checkpoints, Einstellungen).
 *
 * Die Basis-Kanäle (ping, projects, templates) leben in @webaibuilder/core
 * (eingefroren). Da core nicht erweitert werden darf, definiert apps/desktop
 * seine zusätzlichen Kanäle hier — nach derselben Konvention
 * `wab:v<version>:<domäne>:<aktion>` und ebenfalls voll typisiert.
 *
 * Umgebungsneutral (kein node/electron/DOM); von main, preload und renderer
 * gemeinsam genutzt.
 */

import type { AgentEvent, Checkpoint, PermissionDecision } from '@webaibuilder/core';

import type { WabPreviewEvent } from './preview';
import type { AgentSettings, AgentSettingsInput } from './settings';

/* ---------------- Request/Response-Kanäle (renderer → main) ---------------- */

export const DesktopIpcChannels = {
  /** Projekt öffnen: Workspace initialisieren + Preview starten. */
  sessionOpen: 'wab:v1:session:open',
  /** Aktives Projekt schließen: Preview stoppen, Turn abbrechen. */
  sessionClose: 'wab:v1:session:close',
  /** Chat-Nachricht senden: Turn starten (Events kommen als Push). */
  chatSend: 'wab:v1:chat:send',
  /** Laufenden Turn abbrechen (Stopp-Aktion). */
  chatInterrupt: 'wab:v1:chat:interrupt',
  /** Antwort auf eine Permission-Anfrage (Erlauben/Ablehnen). */
  chatPermission: 'wab:v1:chat:permission',
  /** Checkpoints des aktiven Projekts auflisten. */
  checkpointsList: 'wab:v1:checkpoints:list',
  /** Checkpoint wiederherstellen (als neuer Commit). */
  checkpointsRestore: 'wab:v1:checkpoints:restore',
  /** Aktuelle Backend-Einstellungen lesen (ohne den Key). */
  settingsGet: 'wab:v1:settings:get',
  /** Backend-Einstellungen setzen (Key nur renderer → main). */
  settingsSet: 'wab:v1:settings:set',
} as const;

export type DesktopIpcChannel = (typeof DesktopIpcChannels)[keyof typeof DesktopIpcChannels];

/* ---------------- Event-Kanäle (main → renderer, Push) ---------------- */

export const DesktopIpcEvents = {
  /** Ein `AgentEvent` eines laufenden Turns. */
  agent: 'wab:v1:event:agent',
  /** Ein `WabPreviewEvent` (reload / page-console / page-error). */
  preview: 'wab:v1:event:preview',
  /** Frische Checkpoint-Liste (nach Turn-Abschluss / Restore). */
  checkpoints: 'wab:v1:event:checkpoints',
} as const;

export type DesktopIpcEvent = (typeof DesktopIpcEvents)[keyof typeof DesktopIpcEvents];

/* ---------------- Nutzlast-Typen ---------------- */

export interface PreviewInfo {
  /** Vollständige iframe-URL inkl. Token: `http://127.0.0.1:<port>/?wab=<token>`. */
  url: string;
  port: number;
  /** Origin ohne Token — für postMessage-/Fehler-Pfad-Abgleich im Renderer. */
  origin: string;
}

export interface SessionInfo {
  projectId: string;
  preview: PreviewInfo;
  checkpoints: Checkpoint[];
}

export interface ChatSendInput {
  prompt: string;
  /**
   * Vom Renderer erzeugte Lauf-ID. Sie wird vor dem Senden gesetzt, damit die
   * Assistenten-Nachricht existiert, bevor die ersten Push-Events eintreffen
   * (kein Verlust früher text-delta-Events durch eine Race Condition).
   */
  runId: string;
}

export interface ChatSendResult {
  /** Bestätigte Lauf-ID (echo). */
  runId: string;
}

/** Push-Nutzlast eines Agent-Events. */
export interface AgentEventMessage {
  runId: string;
  projectId: string;
  event: AgentEvent;
}

/** Push-Nutzlast eines Preview-Events. */
export interface PreviewEventMessage {
  projectId: string;
  event: WabPreviewEvent;
}

/** Push-Nutzlast der aktualisierten Checkpoint-Liste. */
export interface CheckpointsMessage {
  projectId: string;
  checkpoints: Checkpoint[];
}

/* ---------------- Verträge pro Kanal ---------------- */

export interface DesktopIpcInvokeMap {
  [DesktopIpcChannels.sessionOpen]: { args: [projectId: string]; result: SessionInfo };
  [DesktopIpcChannels.sessionClose]: { args: []; result: void };
  [DesktopIpcChannels.chatSend]: { args: [input: ChatSendInput]; result: ChatSendResult };
  [DesktopIpcChannels.chatInterrupt]: { args: []; result: void };
  [DesktopIpcChannels.chatPermission]: { args: [decision: PermissionDecision]; result: void };
  [DesktopIpcChannels.checkpointsList]: { args: []; result: Checkpoint[] };
  [DesktopIpcChannels.checkpointsRestore]: {
    args: [checkpointId: string];
    result: Checkpoint;
  };
  [DesktopIpcChannels.settingsGet]: { args: []; result: AgentSettings };
  [DesktopIpcChannels.settingsSet]: { args: [input: AgentSettingsInput]; result: AgentSettings };
}

export type DesktopIpcArgs<C extends DesktopIpcChannel> = DesktopIpcInvokeMap[C]['args'];
export type DesktopIpcResult<C extends DesktopIpcChannel> = DesktopIpcInvokeMap[C]['result'];

/** Nutzlast-Typ pro Push-Event-Kanal. */
export interface DesktopIpcEventMap {
  [DesktopIpcEvents.agent]: AgentEventMessage;
  [DesktopIpcEvents.preview]: PreviewEventMessage;
  [DesktopIpcEvents.checkpoints]: CheckpointsMessage;
}

export type DesktopIpcEventPayload<C extends DesktopIpcEvent> = DesktopIpcEventMap[C];
