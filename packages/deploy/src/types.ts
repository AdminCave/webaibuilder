/**
 * Public types of the deploy engine. The types live in this package
 * (core is frozen) — index.ts re-exports them, internal modules
 * import from here (no circular dependency via index.ts).
 */

/** File name of the remote manifest in the target directory. */
export const MANIFEST_FILENAME = '.wab-manifest.json';

/** Current schema version of the remote manifest. */
export const MANIFEST_VERSION = 1 as const;

/** Remote manifest: hash tree + commit SHA (→ "deployed" badge, drift detection). */
export interface DeployManifest {
  version: 1;
  /** Commit SHA of the deployed state. */
  commit: string;
  generatedAt: string;
  /** Relative POSIX path → SHA-256 of the file content. */
  files: Record<string, string>;
}

/** Runtime credentials from the keychain — never persist, never log. */
export interface DeployCredentials {
  password?: string;
  /** Private key (PEM) for SFTP. */
  privateKey?: string;
  passphrase?: string;
}

/** Capabilities the preflight probes per host (only record, do not build on them). */
export interface DeployCapabilities {
  /** Server can create directories recursively. */
  mkdirRecursive: boolean;
  /** RNTO/rename works (for later safe-swap deploys — v1 does not use it). */
  rename: boolean;
  /** TLS session reuse active (many shared hosters require it for FTPS). */
  tlsSessionReuse?: boolean;
}

/** Result of the preflight connection test + capability probe (PLAN §4). */
export interface PreflightResult {
  ok: boolean;
  /** Human-readable findings for the UI. */
  messages: string[];
  /** Plain-text errors when `ok` is false. */
  failures: string[];
  capabilities: DeployCapabilities;
  /** Manifest on the server, if present (drift detection). */
  remoteManifest?: DeployManifest | null;
  /** Commit SHA per the remote manifest — "which version is currently deployed". */
  remoteSha: string | null;
}

/** Minimal upload/delete ops from local hash tree vs. remote manifest. */
export interface DeployPlan {
  /** Relative paths that are uploaded new/changed. */
  uploads: string[];
  /** Relative paths that are removed remotely. */
  deletes: string[];
  unchangedCount: number;
}

/** Result of a deploy/rollback — counters + the executed plan. */
export interface DeployResult {
  /** Deployed commit SHA (as written in the remote manifest). */
  commit: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  /** Total of uploaded bytes (excluding manifest). */
  bytesUploaded: number;
  plan: DeployPlan;
}

/** Progress events for the deploy UI (file-by-file). */
export type DeployProgressEvent =
  | { type: 'connecting' }
  | { type: 'planning' }
  | { type: 'ensuring-dirs'; total: number }
  | { type: 'uploading'; path: string; index: number; total: number }
  | { type: 'deleting'; path: string; index: number; total: number }
  | { type: 'manifest-written'; commit: string }
  | { type: 'done'; result: DeployResult }
  | { type: 'error'; message: string };

/** Progress callback — the UI uses it to display progress. */
export type DeployProgress = (event: DeployProgressEvent) => void;

/** Options for {@link deploy}. */
export interface DeployOptions {
  /** Docroot that is uploaded (`<workspace>/site`). */
  siteDir: string;
  /** Commit SHA written into the manifest. */
  commitSha: string;
  onProgress?: DeployProgress;
}

/** Options for {@link rollback}. */
export interface RollbackOptions {
  /** Workspace with the git repo (`<workspace>/.git`, docroot under `site/`). */
  workspaceDir: string;
  /** Target commit whose `site/` tree is restored. */
  toCommitSha: string;
  onProgress?: DeployProgress;
}

/** Result of drift detection (registry expectation ⟷ remote manifest). */
export interface DriftResult {
  /** true if the remote differs from the expected SHA. */
  drift: boolean;
  /** Expected SHA (what the registry considers deployed). */
  expectedSha: string;
  /** SHA per the remote manifest (null = no manifest / never deployed). */
  remoteSha: string | null;
}
