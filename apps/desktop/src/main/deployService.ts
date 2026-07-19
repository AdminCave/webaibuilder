/**
 * Deploy orchestration in the main process (M3, PLAN §4): connection test,
 * publishing (preflight → deploy), and rollback-deploy of an older version.
 * Streams progress file-by-file to the renderer, writes the deployed commit SHA
 * per target into the registry after success, and maintains a deploy history.
 *
 * The actual sync/transport work is done by `@webaibuilder/deploy`. These
 * functions are injected via the {@link DeployEngine} interface → headless
 * testable with a fake (no real server needed; the deploy package already
 * round-trip-tests the transport itself).
 *
 * Secrets (password/passphrase) come from the keychain only here and go
 * exclusively to the engine — never to the renderer, never into the log.
 */

import type { DeployTarget, Project, ProjectRegistry } from '@webaibuilder/core';
import type {
  DeployCredentials,
  DeployOptions,
  DeployResult,
  DriftResult,
  PreflightResult,
  RollbackOptions,
} from '@webaibuilder/deploy';

import type {
  DeployProgressMessage,
  DeployTargetsMessage,
} from '../shared/channels';
import {
  computeDrift,
  type DeployRunOutcome,
  type WabDeployProgressEvent,
  type WabDriftResult,
  type WabPreflightResult,
} from '../shared/deploy';
import type { DeployHistoryStore } from './deployHistory';
import type { DeployTargetService } from './deployTargets';

/** The subset of functions the deploy engine requires (injectable). */
export interface DeployEngine {
  preflight(target: DeployTarget, credentials: DeployCredentials): Promise<PreflightResult>;
  deploy(
    target: DeployTarget,
    credentials: DeployCredentials,
    options: DeployOptions,
  ): Promise<DeployResult>;
  rollback(
    target: DeployTarget,
    credentials: DeployCredentials,
    options: RollbackOptions,
  ): Promise<DeployResult>;
  detectDrift(
    target: DeployTarget,
    credentials: DeployCredentials,
    expectedSha: string,
  ): Promise<DriftResult>;
}

export interface DeployServiceOptions {
  registry: ProjectRegistry;
  targets: DeployTargetService;
  history: DeployHistoryStore;
  engine: DeployEngine;
  /** git HEAD SHA of the workspace (usually versioning.currentSha). */
  currentSha: (workspaceDir: string) => Promise<string>;
  /** Time source for last_deployed_at (default: new Date()). */
  now?: () => Date;
  /** Push a progress event to the renderer. */
  emitProgress: (message: DeployProgressMessage) => void;
  /** Push the fresh target list (after a changed last_deployed SHA). */
  emitTargets: (message: DeployTargetsMessage) => void;
}

/** Message shown when a target has no stored credentials. */
const NO_CREDENTIALS =
  'No credentials are stored for this target. Enter the password first.';

export class DeployService {
  private readonly registry: ProjectRegistry;
  private readonly targets: DeployTargetService;
  private readonly history: DeployHistoryStore;
  private readonly engine: DeployEngine;
  private readonly currentSha: (workspaceDir: string) => Promise<string>;
  private readonly now: () => Date;
  private readonly emitProgress: (message: DeployProgressMessage) => void;
  private readonly emitTargets: (message: DeployTargetsMessage) => void;

  constructor(options: DeployServiceOptions) {
    this.registry = options.registry;
    this.targets = options.targets;
    this.history = options.history;
    this.engine = options.engine;
    this.currentSha = options.currentSha;
    this.now = options.now ?? (() => new Date());
    this.emitProgress = options.emitProgress;
    this.emitTargets = options.emitTargets;
  }

  /**
   * Connection test = preflight alone (no deploy). Does not throw on
   * connection/auth errors, but returns them structured.
   */
  async testConnection(projectId: string, targetId: string): Promise<WabPreflightResult> {
    const { target, credentials } = await this.loadContext(projectId, targetId);
    if (credentials === null) {
      return this.noCredentialsPreflight();
    }
    const result = await this.engine.preflight(target, credentials);
    return toWirePreflight(result);
  }

  /**
   * Publishes the current state: (b) preflight, (c) on success deploy with the
   * git HEAD SHA as commitSha and `<workspace>/site` as siteDir. After `done`,
   * the deployed SHA is stored per target and the history is appended.
   */
  async run(projectId: string, targetId: string, runId: string): Promise<DeployRunOutcome> {
    const { project, target, credentials } = await this.loadContext(projectId, targetId);
    const { emit, wasTerminal } = this.emitter(projectId, targetId, runId);

    if (credentials === null) {
      emit({ type: 'error', message: NO_CREDENTIALS });
      return { status: 'preflight-failed', preflight: this.noCredentialsPreflight() };
    }

    // (b) Preflight first.
    let preflight: PreflightResult;
    try {
      preflight = await this.engine.preflight(target, credentials);
    } catch (err) {
      return this.fail(emit, wasTerminal, projectId, target, 'deploy', '', err);
    }
    if (!preflight.ok) {
      emit({ type: 'error', message: preflightFailureMessage(preflight) });
      return { status: 'preflight-failed', preflight: toWirePreflight(preflight) };
    }

    // (c) Deploy with git HEAD SHA + site/ docroot.
    let commitSha = '';
    try {
      commitSha = await this.currentSha(project.workspaceDir);
      const result = await this.engine.deploy(target, credentials, {
        siteDir: project.siteDir,
        commitSha,
        onProgress: emit,
      });
      await this.afterDeploy(project, target, 'deploy', result);
      return { status: 'deployed', result };
    } catch (err) {
      return this.fail(emit, wasTerminal, projectId, target, 'deploy', commitSha, err);
    }
  }

  /**
   * Rollback deploy (PLAN §4): materializes `toCommitSha` from git and runs the
   * same delta sync. Distinct from the M2 workspace restore.
   */
  async rollback(
    projectId: string,
    targetId: string,
    toCommitSha: string,
    runId: string,
  ): Promise<DeployRunOutcome> {
    const { project, target, credentials } = await this.loadContext(projectId, targetId);
    const { emit, wasTerminal } = this.emitter(projectId, targetId, runId);

    if (credentials === null) {
      emit({ type: 'error', message: NO_CREDENTIALS });
      return { status: 'error', message: NO_CREDENTIALS };
    }

    try {
      const result = await this.engine.rollback(target, credentials, {
        workspaceDir: project.workspaceDir,
        toCommitSha,
        onProgress: emit,
      });
      await this.afterDeploy(project, target, 'rollback', result);
      return { status: 'deployed', result };
    } catch (err) {
      return this.fail(emit, wasTerminal, projectId, target, 'rollback', toCommitSha, err);
    }
  }

  /**
   * Drift detection with a connection: remote manifest SHA vs. the SHA the
   * registry considers deployed. Without credentials, no network access → no drift.
   */
  async drift(projectId: string, targetId: string): Promise<WabDriftResult> {
    const { target, credentials } = await this.loadContext(projectId, targetId);
    const expectedSha = target.lastDeployedCommit ?? '';
    if (credentials === null) {
      return computeDrift(expectedSha, null);
    }
    const result = await this.engine.detectDrift(target, credentials, expectedSha);
    return { drift: result.drift, expectedSha: result.expectedSha, remoteSha: result.remoteSha };
  }

  /** Deploy history of the project (newest first). */
  listHistory(projectId: string): ReturnType<DeployHistoryStore['list']> {
    return this.history.list(projectId);
  }

  /* ---------------- internal ---------------- */

  /**
   * Builds the emitter for a run. Remembers whether the engine already pushed a
   * terminal `done`/`error` — in that case `fail` does not report a second
   * error (errors BEFORE the engine call are emitted here instead).
   */
  private emitter(
    projectId: string,
    targetId: string,
    runId: string,
  ): { emit: (event: WabDeployProgressEvent) => void; wasTerminal: () => boolean } {
    let terminal = false;
    const emit = (event: WabDeployProgressEvent): void => {
      if (event.type === 'done' || event.type === 'error') terminal = true;
      this.emitProgress({ projectId, targetId, runId, event });
    };
    return { emit, wasTerminal: () => terminal };
  }

  private async afterDeploy(
    project: Project,
    target: DeployTarget,
    kind: 'deploy' | 'rollback',
    result: DeployResult,
  ): Promise<void> {
    await this.markDeployed(project, target.id, result.commit);
    this.history.append({
      projectId: project.id,
      targetId: target.id,
      targetName: target.name,
      kind,
      sha: result.commit,
      uploaded: result.uploaded,
      deleted: result.deleted,
      unchanged: result.unchanged,
      bytesUploaded: result.bytesUploaded,
      ok: true,
    });
    await this.pushTargets(project.id);
  }

  private async fail(
    emit: (event: WabDeployProgressEvent) => void,
    wasTerminal: () => boolean,
    projectId: string,
    target: DeployTarget,
    kind: 'deploy' | 'rollback',
    sha: string,
    err: unknown,
  ): Promise<DeployRunOutcome> {
    const message = describeError(err);
    // Only emit if the engine did not already send a terminal event.
    if (!wasTerminal()) emit({ type: 'error', message });
    this.history.append({
      projectId,
      targetId: target.id,
      targetName: target.name,
      kind,
      sha,
      uploaded: 0,
      deleted: 0,
      unchanged: 0,
      bytesUploaded: 0,
      ok: false,
      error: message,
    });
    return { status: 'error', message };
  }

  /** Writes the deployed SHA for ONE target; other targets keep their SHA. */
  private async markDeployed(project: Project, targetId: string, commit: string): Promise<void> {
    const at = this.now().toISOString();
    const nextTargets = project.deployTargets.map((t) =>
      t.id === targetId ? { ...t, lastDeployedCommit: commit, lastDeployedAt: at } : t,
    );
    await this.registry.update(project.id, { deployTargets: nextTargets });
  }

  private async pushTargets(projectId: string): Promise<void> {
    const targets = await this.targets.list(projectId);
    this.emitTargets({ projectId, targets });
  }

  private noCredentialsPreflight(): WabPreflightResult {
    return {
      ok: false,
      messages: [],
      failures: [NO_CREDENTIALS],
      capabilities: { mkdirRecursive: false, rename: false },
      remoteSha: null,
    };
  }

  private async loadContext(
    projectId: string,
    targetId: string,
  ): Promise<{ project: Project; target: DeployTarget; credentials: DeployCredentials | null }> {
    const project = await this.registry.get(projectId);
    if (project === null) throw new Error('Project not found.');
    const target = project.deployTargets.find((t) => t.id === targetId);
    if (target === undefined) throw new Error('Deploy target not found.');
    const credentials = this.targets.getCredentials(targetId);
    return { project, target, credentials };
  }
}

/* ------------------------------------------------------------------ */
/* Helper functions                                                    */
/* ------------------------------------------------------------------ */

/** Engine preflight → renderer view (without the manifest's hash tree). */
function toWirePreflight(result: PreflightResult): WabPreflightResult {
  return {
    ok: result.ok,
    messages: result.messages,
    failures: result.failures,
    capabilities: result.capabilities,
    remoteSha: result.remoteSha,
  };
}

function preflightFailureMessage(result: PreflightResult): string {
  return result.failures.length > 0
    ? result.failures.join(' ')
    : 'The connection test failed.';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
