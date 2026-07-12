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

import type { AgentEvent, BackendId, Checkpoint, PermissionDecision } from '@webaibuilder/core';

import type { BackendPickerState } from './backends';
import type {
  DeployHistoryRecord,
  DeployRunOutcome,
  DeployTargetInput,
  DeployTargetView,
  WabDeployProgressEvent,
  WabDriftResult,
  WabPreflightResult,
} from './deploy';
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
  /** Deploy-Ziele eines Projekts auflisten (inkl. hasCredentials). */
  deployTargetsList: 'wab:v1:deploytargets:list',
  /** Deploy-Ziel anlegen/ändern (Passwort → Schlüsselbund). */
  deployTargetsSave: 'wab:v1:deploytargets:save',
  /** Deploy-Ziel löschen (entfernt auch das Schlüsselbund-Secret). */
  deployTargetsDelete: 'wab:v1:deploytargets:delete',
  /** Verbindungstest (nur Preflight), liefert strukturierte Befunde. */
  deployTest: 'wab:v1:deploy:test',
  /** Aktuellen Stand veröffentlichen (Preflight + Deploy, Fortschritt als Push). */
  deployRun: 'wab:v1:deploy:run',
  /** Ältere Version deployen (Rollback-Deploy, Fortschritt als Push). */
  deployRollback: 'wab:v1:deploy:rollback',
  /** Drift-Erkennung: Remote-Stand vs. erwartete SHA. */
  deployDrift: 'wab:v1:deploy:drift',
  /** Deploy-Historie eines Projekts auflisten. */
  deployHistory: 'wab:v1:deploy:history',
  /** KI-Backends erkennen + Kill-Switch-Merge (aus dem Cache, M4). */
  backendsList: 'wab:v1:backends:list',
  /** Backends neu prüfen (erzwingt frische Detection, M4). */
  backendsRefresh: 'wab:v1:backends:refresh',
  /** Einen Backend-Hinweis einmalig bestätigen (Claude-Abo, M4). */
  backendsAck: 'wab:v1:backends:ack',
  /** Offiziellen Onboarding-Link im externen Browser öffnen (allowlisted, M4). */
  backendsOpenHint: 'wab:v1:backends:openhint',
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
  /** Ein `WabDeployProgressEvent` eines laufenden Deploys/Rollbacks. */
  deploy: 'wab:v1:event:deploy',
  /** Frische Deploy-Ziel-Liste (nach Deploy/Rollback → neue last_deployed-SHA). */
  targets: 'wab:v1:event:targets',
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

/** Push-Nutzlast eines Deploy-Fortschritts-Events (file-by-file). */
export interface DeployProgressMessage {
  projectId: string;
  targetId: string;
  /** Vom Renderer erzeugte Lauf-ID (korreliert Fortschritt mit dem Aufruf). */
  runId: string;
  event: WabDeployProgressEvent;
}

/** Push-Nutzlast der aktualisierten Deploy-Ziel-Liste (frische last_deployed-SHA). */
export interface DeployTargetsMessage {
  projectId: string;
  targets: DeployTargetView[];
}

/** Ergebnis von {@link DesktopIpcChannels.backendsOpenHint}. */
export interface OpenHintResult {
  /** true = Link war erlaubt und wurde an den externen Browser übergeben. */
  opened: boolean;
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
  [DesktopIpcChannels.deployTargetsList]: {
    args: [projectId: string];
    result: DeployTargetView[];
  };
  [DesktopIpcChannels.deployTargetsSave]: {
    args: [projectId: string, input: DeployTargetInput];
    result: DeployTargetView;
  };
  [DesktopIpcChannels.deployTargetsDelete]: {
    args: [projectId: string, targetId: string];
    result: void;
  };
  [DesktopIpcChannels.deployTest]: {
    args: [projectId: string, targetId: string];
    result: WabPreflightResult;
  };
  [DesktopIpcChannels.deployRun]: {
    args: [projectId: string, targetId: string, runId: string];
    result: DeployRunOutcome;
  };
  [DesktopIpcChannels.deployRollback]: {
    args: [projectId: string, targetId: string, toCommitSha: string, runId: string];
    result: DeployRunOutcome;
  };
  [DesktopIpcChannels.deployDrift]: {
    args: [projectId: string, targetId: string];
    result: WabDriftResult;
  };
  [DesktopIpcChannels.deployHistory]: {
    args: [projectId: string];
    result: DeployHistoryRecord[];
  };
  [DesktopIpcChannels.backendsList]: { args: []; result: BackendPickerState };
  [DesktopIpcChannels.backendsRefresh]: { args: []; result: BackendPickerState };
  [DesktopIpcChannels.backendsAck]: { args: [backendId: BackendId]; result: BackendPickerState };
  [DesktopIpcChannels.backendsOpenHint]: { args: [url: string]; result: OpenHintResult };
}

export type DesktopIpcArgs<C extends DesktopIpcChannel> = DesktopIpcInvokeMap[C]['args'];
export type DesktopIpcResult<C extends DesktopIpcChannel> = DesktopIpcInvokeMap[C]['result'];

/** Nutzlast-Typ pro Push-Event-Kanal. */
export interface DesktopIpcEventMap {
  [DesktopIpcEvents.agent]: AgentEventMessage;
  [DesktopIpcEvents.preview]: PreviewEventMessage;
  [DesktopIpcEvents.checkpoints]: CheckpointsMessage;
  [DesktopIpcEvents.deploy]: DeployProgressMessage;
  [DesktopIpcEvents.targets]: DeployTargetsMessage;
}

export type DesktopIpcEventPayload<C extends DesktopIpcEvent> = DesktopIpcEventMap[C];
