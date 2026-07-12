/**
 * Sitzungs-Orchestrierung im Main-Prozess (M2, PLAN §4):
 *  - Preview-Lebenszyklus pro geöffnetem Projekt (Start/Stop, Event-Forwarding)
 *  - Agent-Turns über `createBackend(...).runTurn(...)` mit Streaming der
 *    AgentEvents an den Renderer und Permission-Round-Trip
 *  - Checkpoint pro Turn (packages/versioning) + Timeline-Push
 *
 * Nur hier laufen electron-/node-/Paket-Zugriffe; der Renderer bleibt sandboxed
 * und spricht ausschließlich über die typisierte Preload-Bridge.
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

/** Trailer-Metadaten, die ein `turn-complete`-Event für den Checkpoint liefert. */
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
  /** Lauf-ID des aktiven Turns; null = kein Turn läuft. */
  private runId: string | null = null;
  /** Session-ID zum Fortsetzen (falls das Backend `resume` kann). */
  private lastSessionId: string | undefined;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly settings: {
      // Jedes der sechs Backends kann das aktive sein (M4). Für Abo-/CLI-Backends
      // liefert `currentApiKey()` bewusst undefined und `currentModel()` "" — die
      // Vendor-CLI bestimmt Login und Modell selbst (PLAN §3).
      currentBackendId(): BackendId;
      currentApiKey(): string | undefined;
      currentModel(): string;
    },
  ) {}

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  /* ---------------- Preview-Lebenszyklus ---------------- */

  async openProject(projectId: string): Promise<SessionInfo> {
    const project = await this.registry.get(projectId);
    if (project === null) {
      throw new Error('Projekt nicht gefunden.');
    }
    // Vorherige Sitzung sauber beenden (Preview + laufender Turn).
    await this.closeProject();

    // git-Workspace sicherstellen (idempotent) — auch bei frisch angelegten
    // Projekten, damit Checkpoints funktionieren (PLAN §4, Versionierung).
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
    // `PreviewEvent` ist strukturgleich zum gespiegelten `WabPreviewEvent`;
    // eine Abweichung würde diese Zuweisung zur Compile-Zeit brechen.
    this.send(DesktopIpcEvents.preview, { projectId, event });
  }

  /* ---------------- Agent-Turn ---------------- */

  sendChat(prompt: string, runId: string): ChatSendResult {
    const project = this.project;
    if (project === null) {
      throw new Error('Kein Projekt geöffnet.');
    }
    if (this.runId !== null) {
      throw new Error('Es läuft bereits ein Turn.');
    }
    const turnRunId = runId.trim() === '' ? randomUUID() : runId;

    // Backend-agnostisch: `createBackend` treibt seit M4 auch die Abo-/CLI-Backends
    // (claude-cli/codex/gemini-cli/grok-cli). Für sie ist `apiKey` undefined und
    // `model` leer — sie spawnen die selbst installierte, selbst eingeloggte
    // Vendor-CLI (PLAN §3). Ist die CLI nicht auffindbar/eingeloggt, meldet der
    // Adapter ein `error`-AgentEvent mit deutschem Installations-/Login-Hinweis
    // (kein rohes ENOENT) — das fließt unten durch `consumeTurn` an die UI.
    const backend = createBackend(this.settings.currentBackendId(), {
      apiKey: this.settings.currentApiKey(),
      model: this.settings.currentModel(),
    });
    this.backend = backend;
    this.runId = turnRunId;

    // Der Event-Strom läuft asynchron; Fehler werden als AgentEvent gemeldet.
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
      // Iterator manuell treiben: der einzige vertragskonforme Weg, die
      // Permission-Entscheidung an das Backend zurückzureichen, ist der
      // TNext-Parameter von `next(value)` (das Backend liest ihn am `yield`).
      const iterator = backend.runTurn(request)[Symbol.asyncIterator]() as AsyncIterator<
        AgentEvent,
        unknown,
        PermissionDecision | undefined
      >;

      let resumeWith: PermissionDecision | undefined;
      for (;;) {
        const result = await iterator.next(resumeWith);
        resumeWith = undefined;
        // Neuer Turn gestartet oder Projekt geschlossen → Strom fallen lassen.
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
        this.emitAgentEvent(project.id, runId, { type: 'error', message, recoverable: false });
        // Synthetischer Abschluss, damit die UI den Laufzustand verlässt.
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
    // Wartende Permission-Anfragen ablehnen, damit kein Promise hängen bleibt.
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
      // Nichts zu committen (keine Datei-Änderung) o. Ä. — kein Checkpoint,
      // aber auch kein harter Fehler für den Turn.
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
      throw new Error('Kein Projekt geöffnet.');
    }
    const checkpoint = await restoreCheckpoint(project.workspaceDir, checkpointId);
    await this.pushCheckpoints(project);
    return checkpoint;
  }

  private async pushCheckpoints(project: Project): Promise<void> {
    const checkpoints = await listWorkspaceCheckpoints(project.workspaceDir);
    this.send(DesktopIpcEvents.checkpoints, { projectId: project.id, checkpoints });
  }

  /* ---------------- Deploy-Push (von DeployService genutzt) ---------------- */

  /** Push eines Deploy-Fortschritts-Events an das aktive Fenster. */
  pushDeployProgress(message: DeployProgressMessage): void {
    this.send(DesktopIpcEvents.deploy, message);
  }

  /** Push der frischen Deploy-Ziel-Liste (nach geänderter last_deployed-SHA). */
  pushDeployTargets(message: DeployTargetsMessage): void {
    this.send(DesktopIpcEvents.targets, message);
  }

  /* ---------------- IPC-Push ---------------- */

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
/* Singleton pro App-Lauf.                                             */
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
    throw new Error('AppSession ist noch nicht initialisiert (initAppSession fehlt).');
  }
  return instance;
}
