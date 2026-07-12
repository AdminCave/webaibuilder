/**
 * Deploy-Engine (PLAN §4, das Herzstück): Hash-Manifest-Sync über
 * ssh2-sftp-client (SFTP) / basic-ftp (FTP/FTPS inkl. TLS-Session-Reuse),
 * Rollback, Preflight. Reihenfolge für Fast-Atomarität:
 * Uploads → Deletes → Manifest zuletzt.
 *
 * Credentials kommen aus dem OS-Schlüsselbund (@napi-rs/keyring) — dieses
 * Paket erhält Secrets nur zur Laufzeit, speichert sie nie.
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
 */

import type { DeployTarget } from '@webaibuilder/core';

/** Dateiname des Remote-Manifests im Zielverzeichnis. */
export const MANIFEST_FILENAME = '.wab-manifest.json';

/** Remote-Manifest: Hash-Baum + Commit-SHA (→ "Deployed"-Badge, Drift-Erkennung). */
export interface DeployManifest {
  version: 1;
  /** Commit-SHA des deployten Standes. */
  commit: string;
  generatedAt: string;
  /** Relativer Pfad → SHA-256 des Dateiinhalts. */
  files: Record<string, string>;
}

/** Laufzeit-Credentials aus dem Schlüsselbund — niemals persistieren. */
export interface DeployCredentials {
  password?: string;
  /** Private Key (PEM) für SFTP. */
  privateKey?: string;
  passphrase?: string;
}

/** Ergebnis des Preflight-Verbindungstests + Capability-Probe (PLAN §4). */
export interface PreflightResult {
  ok: boolean;
  /** Menschlich lesbare Befunde fürs UI (deutsch, Du-Form). */
  messages: string[];
  capabilities: {
    /** Server kann Verzeichnisse rekursiv anlegen. */
    mkdirRecursive: boolean;
    /** TLS-Session-Reuse nötig/aktiv (viele Shared-Hoster verlangen das). */
    tlsSessionReuse?: boolean;
  };
  /** Manifest auf dem Server, falls vorhanden (Drift-Erkennung). */
  remoteManifest?: DeployManifest | null;
}

/** Minimale Upload/Delete-Ops aus lokalem Hash-Baum vs. Remote-Manifest. */
export interface DeployPlan {
  uploads: string[];
  deletes: string[];
  unchangedCount: number;
}

/** Fortschritts-Events für die Deploy-UI. */
export type DeployProgressEvent =
  | { type: 'planning' }
  | { type: 'uploading'; path: string; index: number; total: number }
  | { type: 'deleting'; path: string; index: number; total: number }
  | { type: 'manifest-written'; commit: string }
  | { type: 'done'; plan: DeployPlan }
  | { type: 'error'; message: string };

/**
 * Verbindungstest + Capability-Probe gegen ein Deploy-Ziel.
 * TODO(M3): Test-Matrix Hetzner, IONOS, all-inkl, Strato, Netcup.
 */
export function preflight(
  _target: DeployTarget,
  _credentials: DeployCredentials,
): Promise<PreflightResult> {
  return Promise.reject(new Error('Deploy-Engine ist noch nicht implementiert (kommt in M3).'));
}

/**
 * Berechnet den Deploy-Plan: lokaler Hash-Baum vs. Remote-Manifest.
 * TODO(M3): SHA-256-Baum über `localDir`, Diff gegen `remoteManifest`.
 */
export function planDeploy(
  _localDir: string,
  _remoteManifest: DeployManifest | null,
): Promise<DeployPlan> {
  return Promise.reject(new Error('Deploy-Engine ist noch nicht implementiert (kommt in M3).'));
}

/**
 * Deployt `localDir` (Stand `commit`) auf das Ziel.
 * Reihenfolge: Uploads → Deletes → Manifest zuletzt (Fast-Atomarität).
 * TODO(M3).
 */
export function deploy(
  _target: DeployTarget,
  _credentials: DeployCredentials,
  _localDir: string,
  _commit: string,
): AsyncIterable<DeployProgressEvent> {
  throw new Error('Deploy-Engine ist noch nicht implementiert (kommt in M3).');
}

/**
 * Rollback: alte Version wird von packages/versioning in ein Temp-Verzeichnis
 * materialisiert; hier läuft derselbe Delta-Upload gegen das Remote-Manifest.
 * TODO(M3).
 */
export function rollback(
  _target: DeployTarget,
  _credentials: DeployCredentials,
  _materializedDir: string,
  _commit: string,
): AsyncIterable<DeployProgressEvent> {
  throw new Error('Deploy-Engine ist noch nicht implementiert (kommt in M3).');
}
