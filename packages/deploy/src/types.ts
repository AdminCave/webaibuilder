/**
 * Öffentliche Typen der Deploy-Engine. Die Typen leben in diesem Paket
 * (core ist eingefroren) — index.ts re-exportiert sie, interne Module
 * importieren von hier (keine Ringabhängigkeit über index.ts).
 */

/** Dateiname des Remote-Manifests im Zielverzeichnis. */
export const MANIFEST_FILENAME = '.wab-manifest.json';

/** Aktuelle Schema-Version des Remote-Manifests. */
export const MANIFEST_VERSION = 1 as const;

/** Remote-Manifest: Hash-Baum + Commit-SHA (→ "Deployed"-Badge, Drift-Erkennung). */
export interface DeployManifest {
  version: 1;
  /** Commit-SHA des deployten Standes. */
  commit: string;
  generatedAt: string;
  /** Relativer POSIX-Pfad → SHA-256 des Dateiinhalts. */
  files: Record<string, string>;
}

/** Laufzeit-Credentials aus dem Schlüsselbund — niemals persistieren, niemals loggen. */
export interface DeployCredentials {
  password?: string;
  /** Private Key (PEM) für SFTP. */
  privateKey?: string;
  passphrase?: string;
}

/** Capabilities, die der Preflight pro Host probt (nur erfassen, nicht darauf bauen). */
export interface DeployCapabilities {
  /** Server kann Verzeichnisse rekursiv anlegen. */
  mkdirRecursive: boolean;
  /** RNTO/rename funktioniert (für spätere Safe-Swap-Deploys — v1 nutzt es nicht). */
  rename: boolean;
  /** TLS-Session-Reuse aktiv (viele Shared-Hoster verlangen das bei FTPS). */
  tlsSessionReuse?: boolean;
}

/** Ergebnis des Preflight-Verbindungstests + Capability-Probe (PLAN §4). */
export interface PreflightResult {
  ok: boolean;
  /** Menschlich lesbare Befunde fürs UI (deutsch, Du-Form). */
  messages: string[];
  /** Klartext-Fehler, wenn `ok` false ist (deutsch, Du-Form). */
  failures: string[];
  capabilities: DeployCapabilities;
  /** Manifest auf dem Server, falls vorhanden (Drift-Erkennung). */
  remoteManifest?: DeployManifest | null;
  /** Commit-SHA laut Remote-Manifest — "welche Version liegt gerade drauf". */
  remoteSha: string | null;
}

/** Minimale Upload/Delete-Ops aus lokalem Hash-Baum vs. Remote-Manifest. */
export interface DeployPlan {
  /** Relative Pfade, die neu/geändert hochgeladen werden. */
  uploads: string[];
  /** Relative Pfade, die remote entfernt werden. */
  deletes: string[];
  unchangedCount: number;
}

/** Ergebnis eines Deploys/Rollbacks — Zähler + der ausgeführte Plan. */
export interface DeployResult {
  /** Deployte Commit-SHA (steht so im Remote-Manifest). */
  commit: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  /** Summe der hochgeladenen Bytes (ohne Manifest). */
  bytesUploaded: number;
  plan: DeployPlan;
}

/** Fortschritts-Events für die Deploy-UI (file-by-file). */
export type DeployProgressEvent =
  | { type: 'connecting' }
  | { type: 'planning' }
  | { type: 'ensuring-dirs'; total: number }
  | { type: 'uploading'; path: string; index: number; total: number }
  | { type: 'deleting'; path: string; index: number; total: number }
  | { type: 'manifest-written'; commit: string }
  | { type: 'done'; result: DeployResult }
  | { type: 'error'; message: string };

/** Fortschritts-Callback — die UI zeigt damit den Verlauf an. */
export type DeployProgress = (event: DeployProgressEvent) => void;

/** Optionen für {@link deploy}. */
export interface DeployOptions {
  /** Docroot, der hochgeladen wird (`<workspace>/site`). */
  siteDir: string;
  /** Commit-SHA, die ins Manifest geschrieben wird. */
  commitSha: string;
  onProgress?: DeployProgress;
}

/** Optionen für {@link rollback}. */
export interface RollbackOptions {
  /** Workspace mit dem git-Repo (`<workspace>/.git`, Docroot unter `site/`). */
  workspaceDir: string;
  /** Ziel-Commit, dessen `site/`-Baum wieder hergestellt wird. */
  toCommitSha: string;
  onProgress?: DeployProgress;
}

/** Ergebnis der Drift-Erkennung (Registry-Erwartung ⟷ Remote-Manifest). */
export interface DriftResult {
  /** true, wenn das Remote von der erwarteten SHA abweicht. */
  drift: boolean;
  /** Erwartete SHA (was die Registry für deployt hält). */
  expectedSha: string;
  /** SHA laut Remote-Manifest (null = kein Manifest / nie deployt). */
  remoteSha: string | null;
}
