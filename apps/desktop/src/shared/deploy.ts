/**
 * Renderer-taugliche Spiegelung der Deploy-Engine-Typen (@webaibuilder/deploy)
 * plus reine UI-Logik (Badge-Auflösung, Drift, Fortschritts-Reducer,
 * Formular-Validierung).
 *
 * Warum spiegeln statt importieren: `@webaibuilder/deploy` re-exportiert neben
 * den Typen auch `deploy`/`preflight`/… (node:fs, ssh2, basic-ftp). Würde der
 * Renderer (tsconfig.web, ohne `node`-Typen) den Paket-Einstieg importieren,
 * zöge tsc dessen node-Module in die Typprüfung und scheiterte. Diese Datei ist
 * umgebungsneutral (kein node/electron/DOM) und wird von main, preload und
 * renderer geteilt; der Main-Prozess prüft die Strukturgleichheit zur
 * Compile-Zeit gegen die echten Engine-Typen (siehe deployService.ts).
 *
 * Die Secrets (Passwort/Passphrase) verlassen NIE den Main-Prozess — der
 * Renderer sendet sie einmalig beim Anlegen/Ändern eines Ziels und sieht danach
 * nur noch das abgeleitete `hasCredentials`-Flag.
 */

import type { Checkpoint, DeployProtocol, DeployTarget } from '@webaibuilder/core';

/* ------------------------------------------------------------------ */
/* Gespiegelte Engine-Ergebnistypen (strukturgleich zu packages/deploy) */
/* ------------------------------------------------------------------ */

/** Spiegel von `DeployCapabilities`. */
export interface WabDeployCapabilities {
  mkdirRecursive: boolean;
  rename: boolean;
  tlsSessionReuse?: boolean;
}

/** Spiegel von `DeployPlan`. */
export interface WabDeployPlan {
  uploads: string[];
  deletes: string[];
  unchangedCount: number;
}

/** Spiegel von `DeployResult`. */
export interface WabDeployResult {
  commit: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  bytesUploaded: number;
  plan: WabDeployPlan;
}

/**
 * Renderer-Sicht des Preflight-Ergebnisses. Bewusst OHNE `remoteManifest`
 * (Hash-Baum aller Dateien) — der Renderer braucht nur `remoteSha`. Ansonsten
 * strukturgleich zu `PreflightResult`, sodass der Main-Prozess das echte
 * Ergebnis zuweisen kann.
 */
export interface WabPreflightResult {
  ok: boolean;
  messages: string[];
  failures: string[];
  capabilities: WabDeployCapabilities;
  remoteSha: string | null;
}

/** Spiegel von `DriftResult`. */
export interface WabDriftResult {
  drift: boolean;
  expectedSha: string;
  remoteSha: string | null;
}

/** Spiegel von `DeployProgressEvent` (file-by-file). */
export type WabDeployProgressEvent =
  | { type: 'connecting' }
  | { type: 'planning' }
  | { type: 'ensuring-dirs'; total: number }
  | { type: 'uploading'; path: string; index: number; total: number }
  | { type: 'deleting'; path: string; index: number; total: number }
  | { type: 'manifest-written'; commit: string }
  | { type: 'done'; result: WabDeployResult }
  | { type: 'error'; message: string };

/* ------------------------------------------------------------------ */
/* Deploy-Ziel-Verwaltung (Renderer ↔ Main)                            */
/* ------------------------------------------------------------------ */

/**
 * Renderer-Sicht eines Deploy-Ziels: das secret-freie {@link DeployTarget} plus
 * das abgeleitete Flag, ob im Schlüsselbund Zugangsdaten hinterlegt sind.
 */
export interface DeployTargetView extends DeployTarget {
  /** true, wenn für dieses Ziel ein Passwort im Schlüsselbund liegt. */
  hasCredentials: boolean;
}

/**
 * Was der Renderer zum Anlegen/Ändern eines Ziels schickt. `id` gesetzt =
 * bestehendes Ziel ändern (secret-freie Felder), sonst neu anlegen. `password`/
 * `passphrase`: undefined lässt vorhandene Zugangsdaten unverändert, ein Wert
 * (auch leer für passphrase) setzt sie neu. Das Passwort geht NUR über diesen
 * Weg an den Main-Prozess und landet direkt im Schlüsselbund.
 */
export interface DeployTargetInput {
  id?: string;
  name: string;
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  password?: string;
  passphrase?: string;
}

/** Ergebnis eines Deploy-/Rollback-Laufs (invoke-Antwort). */
export type DeployRunOutcome =
  | { status: 'deployed'; result: WabDeployResult }
  | { status: 'preflight-failed'; preflight: WabPreflightResult }
  | { status: 'error'; message: string };

/** Ein Eintrag der Deploy-Historie (append-only Log). */
export interface DeployHistoryRecord {
  id: string;
  projectId: string;
  targetId: string;
  targetName: string;
  /** 'deploy' = aktuellen Stand, 'rollback' = ältere Version deployt. */
  kind: 'deploy' | 'rollback';
  /** Deployte Commit-SHA (voll). */
  sha: string;
  at: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  bytesUploaded: number;
  ok: boolean;
  /** Fehlermeldung bei ok === false. */
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Ports & Protokolle                                                  */
/* ------------------------------------------------------------------ */

export const DEPLOY_PROTOCOLS: readonly DeployProtocol[] = ['sftp', 'ftp', 'ftps'];

/** Standard-Port je Protokoll (SFTP=22, FTP/FTPS=21). */
export function defaultDeployPort(protocol: DeployProtocol): number {
  return protocol === 'sftp' ? 22 : 21;
}

/* ------------------------------------------------------------------ */
/* Formular-Validierung (rein, deutsch, Du-Form)                       */
/* ------------------------------------------------------------------ */

/**
 * Validiert die secret-freien Ziel-Felder. Liefert eine deutsche Fehlermeldung
 * oder null, wenn alles passt. Wird sowohl im Renderer (Absenden sperren) als
 * auch im Main-Prozess (Schutz vor kaputten Payloads) genutzt.
 */
export function validateDeployTargetInput(input: DeployTargetInput): string | null {
  if (input.name.trim() === '') return 'Gib dem Ziel einen Namen.';
  if (!DEPLOY_PROTOCOLS.includes(input.protocol)) return 'Wähle ein gültiges Protokoll.';
  if (input.host.trim() === '') return 'Trag den Host (Server-Adresse) ein.';
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'Der Port muss zwischen 1 und 65535 liegen.';
  }
  if (input.username.trim() === '') return 'Trag den Benutzernamen ein.';
  if (input.remotePath.trim() === '') return 'Trag das Zielverzeichnis auf dem Server ein.';
  return null;
}

/* ------------------------------------------------------------------ */
/* "Deployed"-Badge & Drift (rein, im Renderer verwendbar)             */
/* ------------------------------------------------------------------ */

/** SHA, die auf dem aktiven Ziel als deployt gilt (oder null). */
export function resolveDeployedSha(
  targets: readonly DeployTargetView[],
  activeTargetId: string | null,
): string | null {
  if (activeTargetId === null) return null;
  const target = targets.find((t) => t.id === activeTargetId);
  return target?.lastDeployedCommit ?? null;
}

/** ID des Checkpoints, dessen SHA dem deployten Stand entspricht (oder null). */
export function deployedCheckpointId(
  checkpoints: readonly Checkpoint[],
  deployedSha: string | null,
): string | null {
  if (deployedSha === null || deployedSha === '') return null;
  const match = checkpoints.find((cp) => cp.id === deployedSha);
  return match?.id ?? null;
}

/**
 * Setzt das `deployed`-Flag auf genau dem Checkpoint, dessen SHA dem deployten
 * Stand des aktiven Ziels entspricht (löst den M1-Platzhalter auf). Andere
 * Checkpoints werden explizit auf `deployed: false` gesetzt.
 */
export function markDeployedCheckpoints(
  checkpoints: readonly Checkpoint[],
  deployedSha: string | null,
): Checkpoint[] {
  const badgedId = deployedCheckpointId(checkpoints, deployedSha);
  return checkpoints.map((cp) => ({ ...cp, deployed: cp.id === badgedId }));
}

/**
 * Reine Drift-Berechnung (Spiegel von `compareDrift`): weicht der Remote-Stand
 * von dem ab, was die Registry für deployt hält? Ein leeres `expectedSha`
 * (noch nie deployt) plus `remoteSha === null` ist KEIN Drift.
 */
export function computeDrift(expectedSha: string, remoteSha: string | null): WabDriftResult {
  const expected = expectedSha === '' ? null : expectedSha;
  return { drift: expected !== remoteSha, expectedSha, remoteSha };
}

/* ------------------------------------------------------------------ */
/* Fortschritts-Reducer (Engine-Events → UI-Zustand)                   */
/* ------------------------------------------------------------------ */

export type DeployPhase =
  | 'idle'
  | 'connecting'
  | 'planning'
  | 'ensuring'
  | 'uploading'
  | 'deleting'
  | 'finalizing'
  | 'done'
  | 'error';

/** UI-Zustand eines laufenden Deploys, abgeleitet aus dem Event-Strom. */
export interface DeployProgressState {
  phase: DeployPhase;
  /** Zuletzt bearbeitete Datei (Upload/Delete). */
  currentFile: string | null;
  uploaded: number;
  uploadTotal: number;
  deleted: number;
  deleteTotal: number;
  /** Verzeichnisse, die vorab angelegt werden. */
  dirTotal: number;
  bytesUploaded: number;
  /** Status-/Fehlertext für die UI (deutsch). */
  message: string | null;
  /** Endergebnis nach `done`. */
  result: WabDeployResult | null;
}

export const initialDeployProgressState: DeployProgressState = {
  phase: 'idle',
  currentFile: null,
  uploaded: 0,
  uploadTotal: 0,
  deleted: 0,
  deleteTotal: 0,
  dirTotal: 0,
  bytesUploaded: 0,
  message: null,
  result: null,
};

/**
 * Reiner Reducer: ein Engine-Fortschritts-Event → neuer UI-Zustand. Headless
 * testbar; die React-Komponente hält diesen Zustand nur.
 */
export function deployProgressReducer(
  state: DeployProgressState,
  event: WabDeployProgressEvent,
): DeployProgressState {
  switch (event.type) {
    case 'connecting':
      return { ...initialDeployProgressState, phase: 'connecting', message: 'Verbinde …' };
    case 'planning':
      return { ...state, phase: 'planning', message: 'Ermittle Änderungen …' };
    case 'ensuring-dirs':
      return { ...state, phase: 'ensuring', dirTotal: event.total, message: 'Lege Verzeichnisse an …' };
    case 'uploading':
      return {
        ...state,
        phase: 'uploading',
        currentFile: event.path,
        // index ist 1-basiert (der gerade laufende Upload).
        uploaded: event.index,
        uploadTotal: event.total,
        message: null,
      };
    case 'deleting':
      return {
        ...state,
        phase: 'deleting',
        currentFile: event.path,
        deleted: event.index,
        deleteTotal: event.total,
        message: null,
      };
    case 'manifest-written':
      return { ...state, phase: 'finalizing', currentFile: null, message: 'Schreibe Manifest …' };
    case 'done':
      return {
        ...state,
        phase: 'done',
        currentFile: null,
        uploaded: event.result.uploaded,
        deleted: event.result.deleted,
        bytesUploaded: event.result.bytesUploaded,
        result: event.result,
        message: null,
      };
    case 'error':
      return { ...state, phase: 'error', currentFile: null, message: event.message };
    default:
      return state;
  }
}

/** Menschliche Kurzbeschreibung eines Protokolls für die UI. */
export function protocolLabel(protocol: DeployProtocol): string {
  switch (protocol) {
    case 'sftp':
      return 'SFTP';
    case 'ftp':
      return 'FTP';
    case 'ftps':
      return 'FTPS';
    default:
      return protocol;
  }
}
