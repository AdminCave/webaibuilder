/**
 * Deploy-Orchestrierung im Main-Prozess (M3, PLAN §4): Verbindungstest,
 * Veröffentlichen (Preflight → Deploy) und Rollback-Deploy einer älteren
 * Version. Streamt den Fortschritt file-by-file an den Renderer, schreibt nach
 * Erfolg die deployte Commit-SHA pro Ziel in die Registry und führt eine
 * Deploy-Historie.
 *
 * Die eigentliche Sync-/Transport-Arbeit macht `@webaibuilder/deploy`. Diese
 * Funktionen sind über die {@link DeployEngine}-Schnittstelle injiziert →
 * headless testbar mit einem Fake (kein echter Server nötig; das Deploy-Paket
 * round-trip-testet den Transport bereits selbst).
 *
 * Secrets (Passwort/Passphrase) kommen nur hier aus dem Schlüsselbund und gehen
 * ausschließlich an die Engine — nie an den Renderer, nie ins Log.
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

/** Die von der Deploy-Engine benötigte Funktions-Teilmenge (injizierbar). */
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
  /** git-HEAD-SHA des Workspace (i. d. R. versioning.currentSha). */
  currentSha: (workspaceDir: string) => Promise<string>;
  /** Zeitquelle für last_deployed_at (Default: new Date()). */
  now?: () => Date;
  /** Push eines Fortschritts-Events an den Renderer. */
  emitProgress: (message: DeployProgressMessage) => void;
  /** Push der frischen Ziel-Liste (nach geänderter last_deployed-SHA). */
  emitTargets: (message: DeployTargetsMessage) => void;
}

/** Deutsche Meldung, wenn ein Ziel keine hinterlegten Zugangsdaten hat. */
const NO_CREDENTIALS =
  'Für dieses Ziel sind keine Zugangsdaten hinterlegt. Trag zuerst das Passwort ein.';

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
   * Verbindungstest = Preflight allein (kein Deploy). Wirft nicht bei
   * Verbindungs-/Auth-Fehlern, sondern liefert sie strukturiert (deutsch).
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
   * Veröffentlicht den aktuellen Stand: (b) Preflight, (c) bei Erfolg Deploy mit
   * der git-HEAD-SHA als commitSha und `<workspace>/site` als siteDir. Nach dem
   * `done` wird die deployte SHA pro Ziel gespeichert und die Historie ergänzt.
   */
  async run(projectId: string, targetId: string, runId: string): Promise<DeployRunOutcome> {
    const { project, target, credentials } = await this.loadContext(projectId, targetId);
    const { emit, wasTerminal } = this.emitter(projectId, targetId, runId);

    if (credentials === null) {
      emit({ type: 'error', message: NO_CREDENTIALS });
      return { status: 'preflight-failed', preflight: this.noCredentialsPreflight() };
    }

    // (b) Preflight zuerst.
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

    // (c) Deploy mit git-HEAD-SHA + site/-Docroot.
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
   * Rollback-Deploy (PLAN §4): materialisiert `toCommitSha` aus git und fährt
   * denselben Delta-Sync. Distinkt vom M2-Workspace-Restore.
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
   * Drift-Erkennung mit Verbindung: Remote-Manifest-SHA vs. die von der Registry
   * für deployt gehaltene SHA. Ohne Zugangsdaten kein Netzzugriff → kein Drift.
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

  /** Deploy-Historie des Projekts (neueste zuerst). */
  listHistory(projectId: string): ReturnType<DeployHistoryStore['list']> {
    return this.history.list(projectId);
  }

  /* ---------------- intern ---------------- */

  /**
   * Baut den Emitter für einen Lauf. Merkt sich, ob die Engine bereits ein
   * terminales `done`/`error` gepusht hat — dann meldet `fail` keinen zweiten
   * Fehler (Fehler VOR dem Engine-Aufruf werden dagegen selbst emittiert).
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
    // Nur emittieren, wenn die Engine nicht schon ein terminales Event schickte.
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

  /** Schreibt die deployte SHA für EIN Ziel; andere Ziele behalten ihre SHA. */
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
    if (project === null) throw new Error('Projekt nicht gefunden.');
    const target = project.deployTargets.find((t) => t.id === targetId);
    if (target === undefined) throw new Error('Deploy-Ziel nicht gefunden.');
    const credentials = this.targets.getCredentials(targetId);
    return { project, target, credentials };
  }
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

/** Engine-Preflight → Renderer-Sicht (ohne den Hash-Baum des Manifests). */
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
    : 'Der Verbindungstest ist fehlgeschlagen.';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
