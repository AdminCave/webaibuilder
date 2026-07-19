/**
 * Session orchestration in the main process (M2, PLAN §4):
 *  - Preview lifecycle per opened project (start/stop, event forwarding)
 *  - Agent turns via `createBackend(...).runTurn(...)` with streaming of the
 *    AgentEvents to the renderer and the permission round-trip
 *  - Checkpoint per turn (packages/versioning) + timeline push
 *
 * Only here do electron/node/package accesses run; the renderer stays sandboxed
 * and communicates exclusively through the typed preload bridge.
 */

import { randomUUID } from 'node:crypto';

import type { BrowserWindow } from 'electron';

import { createBackend } from '@webaibuilder/agents';
import type {
  AgentBackend,
  AgentEvent,
  AgentTurnRequest,
  BackendId,
  Checkpoint,
  PermissionDecision,
  Project,
  ProjectRegistry,
} from '@webaibuilder/core';
import { DEFAULT_PERMISSION_POLICY } from '@webaibuilder/core';
import { startPreviewServer } from '@webaibuilder/preview';
import type { PreviewEvent, PreviewServerHandle } from '@webaibuilder/preview';
import {
  createCheckpoint,
  initWorkspace,
  listCheckpoints as listWorkspaceCheckpoints,
  restoreCheckpoint,
} from '@webaibuilder/versioning';

import {
  DesktopIpcEvents,
  type ChatSendResult,
  type DeployProgressMessage,
  type DeployTargetsMessage,
  type DesktopIpcEvent,
  type DesktopIpcEventPayload,
  type PreviewInfo,
  type SessionInfo,
} from '../shared/channels';
import { PermissionQueue } from '../shared/permissionQueue';

/** Trailer metadata that a `turn-complete` event provides for the checkpoint. */
interface TurnMeta {
  turnId?: string;
  sessionId?: string;
  costUsd?: number;
}

export class AppSession {
  private window: BrowserWindow | null = null;
  private project: Project | null = null;
  private preview: PreviewServerHandle | null = null;
  private previewUnsub: (() => void) | null = null;
  private backend: AgentBackend | null = null;
  private readonly permissions = new PermissionQueue();
  /** Run ID of the active turn; null = no turn is running. */
  private runId: string | null = null;
  /** Session ID for resuming (if the backend supports `resume`). */
  private lastSessionId: string | undefined;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly settings: {
      // Any of the six backends can be the active one (M4). For subscription/CLI
      // backends, `currentApiKey()` deliberately returns undefined and
      // `currentModel()` "" — the vendor CLI determines login and model itself (PLAN §3).
      currentBackendId(): BackendId;
      currentApiKey(): string | undefined;
      currentModel(): string;
    },
  ) {}

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  /* ---------------- Preview lifecycle ---------------- */

  async openProject(projectId: string): Promise<SessionInfo> {
    const project = await this.registry.get(projectId);
    if (project === null) {
      throw new Error('Project not found.');
    }
    // Cleanly end the previous session (preview + running turn).
    await this.closeProject();

    // Ensure the git workspace (idempotent) — also for freshly created projects,
    // so that checkpoints work (PLAN §4, versioning).
    await initWorkspace(project.workspaceDir);

    const preview = await startPreviewServer({ siteDir: project.siteDir });
    this.project = project;
    this.preview = preview;
    this.previewUnsub = preview.events.on((event) => this.forwardPreviewEvent(project.id, event));

    const checkpoints = await listWorkspaceCheckpoints(project.workspaceDir);
    return {
      projectId: project.id,
      preview: this.toPreviewInfo(preview),
      checkpoints,
    };
  }

  async closeProject(): Promise<void> {
    await this.interrupt().catch(() => undefined);
    this.permissions.denyAll();
    this.previewUnsub?.();
    this.previewUnsub = null;
    const preview = this.preview;
    this.preview = null;
    this.project = null;
    this.backend = null;
    this.runId = null;
    this.lastSessionId = undefined;
    if (preview !== null) {
      await preview.close().catch(() => undefined);
    }
  }

  private toPreviewInfo(handle: PreviewServerHandle): PreviewInfo {
    return { url: handle.url, port: handle.port, origin: new URL(handle.url).origin };
  }

  private forwardPreviewEvent(projectId: string, event: PreviewEvent): void {
    // `PreviewEvent` is structurally identical to the mirrored `WabPreviewEvent`;
    // a divergence would break this assignment at compile time.
    this.send(DesktopIpcEvents.preview, { projectId, event });
  }

  /* ---------------- Agent turn ---------------- */

  sendChat(prompt: string, runId: string): ChatSendResult {
    const project = this.project;
    if (project === null) {
      throw new Error('No project open.');
    }
    if (this.runId !== null) {
      throw new Error('A turn is already running.');
    }
    const turnRunId = runId.trim() === '' ? randomUUID() : runId;

    // Backend-agnostic: since M4, `createBackend` also drives the subscription/CLI
    // backends (claude-cli/codex/gemini-cli/grok-cli). For them, `apiKey` is
    // undefined and `model` empty — they spawn the self-installed, self-logged-in
    // vendor CLI (PLAN §3). If the CLI is not found / not logged in, the adapter
    // reports an `error` AgentEvent with an installation/login hint (not a raw
    // ENOENT) — which flows to the UI below via `consumeTurn`.
    const backend = createBackend(this.settings.currentBackendId(), {
      apiKey: this.settings.currentApiKey(),
      model: this.settings.currentModel(),
    });
    this.backend = backend;
    this.runId = turnRunId;

    // The event stream runs asynchronously; errors are reported as an AgentEvent.
    void this.consumeTurn(project, backend, turnRunId, prompt);
    return { runId: turnRunId };
  }

  private async consumeTurn(
    project: Project,
    backend: AgentBackend,
    runId: string,
    prompt: string,
  ): Promise<void> {
    const request: AgentTurnRequest = {
      workspaceDir: project.workspaceDir,
      siteDir: project.siteDir,
      prompt,
      policy: DEFAULT_PERMISSION_POLICY,
      ...(this.lastSessionId !== undefined ? { sessionId: this.lastSessionId } : {}),
    };

    let meta: TurnMeta | null = null;
    try {
      // Drive the iterator manually: the only contract-compliant way to pass the
      // permission decision back to the backend is the TNext parameter of
      // `next(value)` (the backend reads it at the `yield`).
      const iterator = backend.runTurn(request)[Symbol.asyncIterator]() as AsyncIterator<
        AgentEvent,
        unknown,
        PermissionDecision | undefined
      >;

      let resumeWith: PermissionDecision | undefined;
      for (;;) {
        const result = await iterator.next(resumeWith);
        resumeWith = undefined;
        // New turn started or project closed → drop the stream.
        if (this.runId !== runId) break;
        if (result.done === true) break;

        const event = result.value;
        this.emitAgentEvent(project.id, runId, event);

        if (event.type === 'permission-request') {
          resumeWith = await this.permissions.wait(event.requestId);
        } else if (event.type === 'turn-complete') {
          meta = { turnId: event.turnId, sessionId: event.sessionId, costUsd: event.costUsd };
          if (event.sessionId !== undefined) this.lastSessionId = event.sessionId;
        }
      }
    } catch (error) {
      if (this.runId === runId) {
        const message = error instanceof Error ? error.message : String(error);
        // Include `cause` so the UI can show the real cause in an expandable view.
        const cause =
          error instanceof Error && error.cause !== undefined ? String(error.cause) : undefined;
        this.emitAgentEvent(project.id, runId, {
          type: 'error',
          message,
          recoverable: false,
          ...(cause !== undefined ? { cause } : {}),
        });
        // Synthetic completion so the UI leaves the running state.
        this.emitAgentEvent(project.id, runId, {
          type: 'turn-complete',
          turnId: runId,
          stopReason: 'error',
        });
      }
    } finally {
      if (this.runId === runId) {
        this.runId = null;
        this.backend = null;
      }
      await this.checkpointAfterTurn(project, prompt, backend.id, meta);
    }
  }

  interrupt(): Promise<void> {
    // Reject pending permission requests so no promise stays hanging.
    this.permissions.denyAll();
    const backend = this.backend;
    if (backend === null) return Promise.resolve();
    return backend.interrupt();
  }

  respondPermission(decision: PermissionDecision): void {
    this.permissions.resolve(decision);
  }

  private async checkpointAfterTurn(
    project: Project,
    prompt: string,
    backendId: AgentBackend['id'],
    meta: TurnMeta | null,
  ): Promise<void> {
    try {
      await createCheckpoint(project.workspaceDir, prompt, {
        backend: backendId,
        ...(meta?.turnId !== undefined ? { turnId: meta.turnId } : {}),
        ...(meta?.sessionId !== undefined ? { sessionId: meta.sessionId } : {}),
        ...(meta?.costUsd !== undefined ? { costUsd: meta.costUsd } : {}),
      });
    } catch {
      // Nothing to commit (no file change) or similar — no checkpoint, but also
      // not a hard error for the turn.
      return;
    }
    await this.pushCheckpoints(project);
  }

  /* ---------------- Checkpoints ---------------- */

  listCheckpoints(): Promise<Checkpoint[]> {
    if (this.project === null) return Promise.resolve([]);
    return listWorkspaceCheckpoints(this.project.workspaceDir);
  }

  async restore(checkpointId: string): Promise<Checkpoint> {
    const project = this.project;
    if (project === null) {
      throw new Error('No project open.');
    }
    const checkpoint = await restoreCheckpoint(project.workspaceDir, checkpointId);
    await this.pushCheckpoints(project);
    return checkpoint;
  }

  private async pushCheckpoints(project: Project): Promise<void> {
    const checkpoints = await listWorkspaceCheckpoints(project.workspaceDir);
    this.send(DesktopIpcEvents.checkpoints, { projectId: project.id, checkpoints });
  }

  /* ---------------- Deploy push (used by DeployService) ---------------- */

  /** Push a deploy-progress event to the active window. */
  pushDeployProgress(message: DeployProgressMessage): void {
    this.send(DesktopIpcEvents.deploy, message);
  }

  /** Push the fresh deploy-target list (after a changed last_deployed SHA). */
  pushDeployTargets(message: DeployTargetsMessage): void {
    this.send(DesktopIpcEvents.targets, message);
  }

  /* ---------------- IPC push ---------------- */

  private emitAgentEvent(projectId: string, runId: string, event: AgentEvent): void {
    this.send(DesktopIpcEvents.agent, { runId, projectId, event });
  }

  private send<C extends DesktopIpcEvent>(channel: C, payload: DesktopIpcEventPayload<C>): void {
    const win = this.window;
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Singleton per app run.                                              */
/* ------------------------------------------------------------------ */

let instance: AppSession | null = null;

export function initAppSession(
  registry: ProjectRegistry,
  settings: ConstructorParameters<typeof AppSession>[1],
): AppSession {
  instance ??= new AppSession(registry, settings);
  return instance;
}

export function getAppSession(): AppSession {
  if (instance === null) {
    throw new Error('AppSession is not yet initialized (initAppSession missing).');
  }
  return instance;
}
