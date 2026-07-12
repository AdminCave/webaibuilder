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
  DeployProgressMessage,
  DeployTargetsMessage,
  PreviewEventMessage,
  SessionInfo,
} from './channels';
import type {
  DeployHistoryRecord,
  DeployRunOutcome,
  DeployTargetInput,
  DeployTargetView,
  WabDriftResult,
  WabPreflightResult,
} from './deploy';
import type { AgentSettings, AgentSettingsInput } from './settings';

/**
 * Version der additiven Desktop-Bridge-Oberfläche.
 * v2 (M3): `settings.get`/`set` liefern zusätzlich `keychainAvailable`; API-Keys
 *          liegen im OS-Schlüsselbund statt nur im Main-Prozess-Speicher.
 * v3 (M3): Deploy-Oberfläche — Ziel-CRUD (Passwort → Schlüsselbund),
 *          Verbindungstest, Veröffentlichen/Rollback mit Fortschritts-Push,
 *          Drift-Erkennung, Deploy-Historie.
 */
export const WAB_DESKTOP_BRIDGE_VERSION = 3;

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

  deploy: {
    /** Deploy-Ziele eines Projekts (inkl. hasCredentials). */
    listTargets(projectId: string): Promise<DeployTargetView[]>;
    /** Ziel anlegen/ändern; Passwort/Passphrase gehen in den Schlüsselbund. */
    saveTarget(projectId: string, input: DeployTargetInput): Promise<DeployTargetView>;
    /** Ziel löschen (entfernt auch das Schlüsselbund-Secret). */
    deleteTarget(projectId: string, targetId: string): Promise<void>;
    /** Verbindungstest (nur Preflight) — strukturierte Befunde, deutsch. */
    test(projectId: string, targetId: string): Promise<WabPreflightResult>;
    /** Aktuellen Stand veröffentlichen; Fortschritt kommt über `onDeployProgress`. */
    run(projectId: string, targetId: string, runId: string): Promise<DeployRunOutcome>;
    /** Ältere Version deployen (Rollback-Deploy). */
    rollback(
      projectId: string,
      targetId: string,
      toCommitSha: string,
      runId: string,
    ): Promise<DeployRunOutcome>;
    /** Drift-Erkennung: weicht der Remote-Stand von der erwarteten SHA ab? */
    drift(projectId: string, targetId: string): Promise<WabDriftResult>;
    /** Deploy-Historie des Projekts (neueste zuerst). */
    history(projectId: string): Promise<DeployHistoryRecord[]>;
  };

  events: {
    onAgentEvent(listener: (message: AgentEventMessage) => void): Unsubscribe;
    onPreviewEvent(listener: (message: PreviewEventMessage) => void): Unsubscribe;
    onCheckpoints(listener: (message: CheckpointsMessage) => void): Unsubscribe;
    onDeployProgress(listener: (message: DeployProgressMessage) => void): Unsubscribe;
    onDeployTargets(listener: (message: DeployTargetsMessage) => void): Unsubscribe;
  };
}
