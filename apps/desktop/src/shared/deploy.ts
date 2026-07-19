/**
 * Renderer-friendly mirror of the deploy-engine types (@webaibuilder/deploy)
 * plus pure UI logic (badge resolution, drift, progress reducer, form
 * validation).
 *
 * Why mirror instead of import: `@webaibuilder/deploy` re-exports, alongside the
 * types, also `deploy`/`preflight`/… (node:fs, ssh2, basic-ftp). If the renderer
 * (tsconfig.web, without `node` types) imported the package entry point, tsc
 * would pull its node modules into type checking and fail. This file is
 * environment-neutral (no node/electron/DOM) and shared by main, preload, and
 * renderer; the main process verifies structural equality against the real
 * engine types at compile time (see deployService.ts).
 *
 * The secrets (password/passphrase) NEVER leave the main process — the renderer
 * sends them once when creating/updating a target and afterwards only sees the
 * derived `hasCredentials` flag.
 */

import type { Checkpoint, DeployProtocol, DeployTarget } from '@webaibuilder/core';

/* ------------------------------------------------------------------ */
/* Mirrored engine result types (structurally equal to packages/deploy) */
/* ------------------------------------------------------------------ */

/** Mirror of `DeployCapabilities`. */
export interface WabDeployCapabilities {
  mkdirRecursive: boolean;
  rename: boolean;
  tlsSessionReuse?: boolean;
}

/** Mirror of `DeployPlan`. */
export interface WabDeployPlan {
  uploads: string[];
  deletes: string[];
  unchangedCount: number;
}

/** Mirror of `DeployResult`. */
export interface WabDeployResult {
  commit: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  bytesUploaded: number;
  plan: WabDeployPlan;
}

/**
 * Renderer view of the preflight result. Deliberately WITHOUT `remoteManifest`
 * (hash tree of all files) — the renderer only needs `remoteSha`. Otherwise
 * structurally equal to `PreflightResult`, so the main process can assign the
 * real result.
 */
export interface WabPreflightResult {
  ok: boolean;
  messages: string[];
  failures: string[];
  capabilities: WabDeployCapabilities;
  remoteSha: string | null;
}

/** Mirror of `DriftResult`. */
export interface WabDriftResult {
  drift: boolean;
  expectedSha: string;
  remoteSha: string | null;
}

/** Mirror of `DeployProgressEvent` (file-by-file). */
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
/* Deploy-target management (renderer ↔ main)                          */
/* ------------------------------------------------------------------ */

/**
 * Renderer view of a deploy target: the secret-free {@link DeployTarget} plus the
 * derived flag indicating whether credentials are stored in the keychain.
 */
export interface DeployTargetView extends DeployTarget {
  /** true if a password for this target is in the keychain. */
  hasCredentials: boolean;
}

/**
 * What the renderer sends to create/update a target. `id` set = update an
 * existing target (secret-free fields), otherwise create a new one.
 * `password`/`passphrase`: undefined leaves existing credentials unchanged, a
 * value (empty is also allowed for passphrase) sets them anew. The password goes
 * to the main process ONLY via this path and lands directly in the keychain.
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

/** Result of a deploy/rollback run (invoke response). */
export type DeployRunOutcome =
  | { status: 'deployed'; result: WabDeployResult }
  | { status: 'preflight-failed'; preflight: WabPreflightResult }
  | { status: 'error'; message: string };

/** An entry in the deploy history (append-only log). */
export interface DeployHistoryRecord {
  id: string;
  projectId: string;
  targetId: string;
  targetName: string;
  /** 'deploy' = deployed the current state, 'rollback' = deployed an older version. */
  kind: 'deploy' | 'rollback';
  /** Deployed commit SHA (full). */
  sha: string;
  at: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  bytesUploaded: number;
  ok: boolean;
  /** Error message when ok === false. */
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Ports & protocols                                                   */
/* ------------------------------------------------------------------ */

export const DEPLOY_PROTOCOLS: readonly DeployProtocol[] = ['sftp', 'ftp', 'ftps'];

/** Default port per protocol (SFTP=22, FTP/FTPS=21). */
export function defaultDeployPort(protocol: DeployProtocol): number {
  return protocol === 'sftp' ? 22 : 21;
}

/* ------------------------------------------------------------------ */
/* Form validation (pure)                                              */
/* ------------------------------------------------------------------ */

/**
 * Validates the secret-free target fields. Returns an error message or null if
 * everything is fine. Used both in the renderer (block submit) and in the main
 * process (protection against broken payloads).
 */
export function validateDeployTargetInput(input: DeployTargetInput): string | null {
  if (input.name.trim() === '') return 'Give the target a name.';
  if (!DEPLOY_PROTOCOLS.includes(input.protocol)) return 'Choose a valid protocol.';
  if (input.host.trim() === '') return 'Enter the host (server address).';
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'The port must be between 1 and 65535.';
  }
  if (input.username.trim() === '') return 'Enter the username.';
  if (input.remotePath.trim() === '') return 'Enter the target directory on the server.';
  return null;
}

/* ------------------------------------------------------------------ */
/* "Deployed" badge & drift (pure, usable in the renderer)             */
/* ------------------------------------------------------------------ */

/** The SHA that counts as deployed on the active target (or null). */
export function resolveDeployedSha(
  targets: readonly DeployTargetView[],
  activeTargetId: string | null,
): string | null {
  if (activeTargetId === null) return null;
  const target = targets.find((t) => t.id === activeTargetId);
  return target?.lastDeployedCommit ?? null;
}

/** ID of the checkpoint whose SHA matches the deployed state (or null). */
export function deployedCheckpointId(
  checkpoints: readonly Checkpoint[],
  deployedSha: string | null,
): string | null {
  if (deployedSha === null || deployedSha === '') return null;
  const match = checkpoints.find((cp) => cp.id === deployedSha);
  return match?.id ?? null;
}

/**
 * Sets the `deployed` flag on exactly the checkpoint whose SHA matches the
 * deployed state of the active target (resolves the M1 placeholder). Other
 * checkpoints are explicitly set to `deployed: false`.
 */
export function markDeployedCheckpoints(
  checkpoints: readonly Checkpoint[],
  deployedSha: string | null,
): Checkpoint[] {
  const badgedId = deployedCheckpointId(checkpoints, deployedSha);
  return checkpoints.map((cp) => ({ ...cp, deployed: cp.id === badgedId }));
}

/**
 * Pure drift computation (mirror of `compareDrift`): does the remote state differ
 * from what the registry considers deployed? An empty `expectedSha` (never
 * deployed) plus `remoteSha === null` is NOT drift.
 */
export function computeDrift(expectedSha: string, remoteSha: string | null): WabDriftResult {
  const expected = expectedSha === '' ? null : expectedSha;
  return { drift: expected !== remoteSha, expectedSha, remoteSha };
}

/* ------------------------------------------------------------------ */
/* Progress reducer (engine events → UI state)                         */
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

/** UI state of a running deploy, derived from the event stream. */
export interface DeployProgressState {
  phase: DeployPhase;
  /** Most recently processed file (upload/delete). */
  currentFile: string | null;
  uploaded: number;
  uploadTotal: number;
  deleted: number;
  deleteTotal: number;
  /** Directories that are created upfront. */
  dirTotal: number;
  bytesUploaded: number;
  /** Status/error text for the UI. */
  message: string | null;
  /** Final result after `done`. */
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
 * Pure reducer: one engine progress event → new UI state. Headless-testable; the
 * React component only holds this state.
 */
export function deployProgressReducer(
  state: DeployProgressState,
  event: WabDeployProgressEvent,
): DeployProgressState {
  switch (event.type) {
    case 'connecting':
      return { ...initialDeployProgressState, phase: 'connecting', message: 'Connecting …' };
    case 'planning':
      return { ...state, phase: 'planning', message: 'Determining changes …' };
    case 'ensuring-dirs':
      return { ...state, phase: 'ensuring', dirTotal: event.total, message: 'Creating directories …' };
    case 'uploading':
      return {
        ...state,
        phase: 'uploading',
        currentFile: event.path,
        // index is 1-based (the upload currently in progress).
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
      return { ...state, phase: 'finalizing', currentFile: null, message: 'Writing manifest …' };
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

/** Short human-readable description of a protocol for the UI. */
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
