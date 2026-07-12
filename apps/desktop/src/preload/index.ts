/**
 * Preload: typisierte, versionierte, minimale Bridge (`window.wab`).
 * Läuft sandboxed — nur `electron` ist importierbar, alles andere wird
 * von electron-vite in diese Datei gebundelt.
 *
 * Die Bridge vereint den eingefrorenen core-Vertrag (`WabBridge`: ping,
 * projects, templates) mit der additiven M2-Oberfläche (`WabDesktopBridge`:
 * session, chat, checkpoints, settings, Event-Abos).
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type {
  BackendId,
  PermissionDecision,
  ProjectCreateInput,
  ProjectUpdateInput,
  WabBridge,
} from '@webaibuilder/core';
import { BRIDGE_KEY, BRIDGE_VERSION, IpcChannels } from '@webaibuilder/core';

import {
  DesktopIpcChannels,
  DesktopIpcEvents,
  type AgentEventMessage,
  type CheckpointsMessage,
  type DeployProgressMessage,
  type DeployTargetsMessage,
  type DesktopIpcEvent,
  type DesktopIpcEventPayload,
  type PreviewEventMessage,
  type UpdateStatus,
} from '../shared/channels';
import {
  WAB_DESKTOP_BRIDGE_VERSION,
  type Unsubscribe,
  type WabDesktopBridge,
} from '../shared/bridge';
import type { DeployTargetInput } from '../shared/deploy';
import type { RendererErrorReport } from '../shared/logging';
import type { OnboardingStateInput } from '../shared/onboarding';
import type { AgentSettingsInput } from '../shared/settings';

/** Abonniert einen Push-Kanal und liefert die Abmelde-Funktion. */
function subscribe<C extends DesktopIpcEvent>(
  channel: C,
  listener: (payload: DesktopIpcEventPayload<C>) => void,
): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: DesktopIpcEventPayload<C>): void =>
    listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const bridge: WabBridge & WabDesktopBridge = {
  version: BRIDGE_VERSION,
  desktopVersion: WAB_DESKTOP_BRIDGE_VERSION,

  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  projects: {
    list: () => ipcRenderer.invoke(IpcChannels.projectsList),
    get: (id: string) => ipcRenderer.invoke(IpcChannels.projectsGet, id),
    create: (input: ProjectCreateInput) => ipcRenderer.invoke(IpcChannels.projectsCreate, input),
    update: (id: string, patch: ProjectUpdateInput) =>
      ipcRenderer.invoke(IpcChannels.projectsUpdate, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IpcChannels.projectsDelete, id),
  },
  templates: {
    list: () => ipcRenderer.invoke(IpcChannels.templatesList),
  },

  session: {
    open: (projectId: string) => ipcRenderer.invoke(DesktopIpcChannels.sessionOpen, projectId),
    close: () => ipcRenderer.invoke(DesktopIpcChannels.sessionClose),
  },
  chat: {
    send: (prompt: string, runId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.chatSend, { prompt, runId }),
    interrupt: () => ipcRenderer.invoke(DesktopIpcChannels.chatInterrupt),
    respondPermission: (decision: PermissionDecision) =>
      ipcRenderer.invoke(DesktopIpcChannels.chatPermission, decision),
  },
  checkpoints: {
    list: () => ipcRenderer.invoke(DesktopIpcChannels.checkpointsList),
    restore: (checkpointId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.checkpointsRestore, checkpointId),
  },
  settings: {
    get: () => ipcRenderer.invoke(DesktopIpcChannels.settingsGet),
    set: (input: AgentSettingsInput) => ipcRenderer.invoke(DesktopIpcChannels.settingsSet, input),
  },
  backends: {
    list: () => ipcRenderer.invoke(DesktopIpcChannels.backendsList),
    refresh: () => ipcRenderer.invoke(DesktopIpcChannels.backendsRefresh),
    acknowledge: (backendId: BackendId) =>
      ipcRenderer.invoke(DesktopIpcChannels.backendsAck, backendId),
    openHint: (url: string) => ipcRenderer.invoke(DesktopIpcChannels.backendsOpenHint, url),
  },
  deploy: {
    listTargets: (projectId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployTargetsList, projectId),
    saveTarget: (projectId: string, input: DeployTargetInput) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployTargetsSave, projectId, input),
    deleteTarget: (projectId: string, targetId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployTargetsDelete, projectId, targetId),
    test: (projectId: string, targetId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployTest, projectId, targetId),
    run: (projectId: string, targetId: string, runId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployRun, projectId, targetId, runId),
    rollback: (projectId: string, targetId: string, toCommitSha: string, runId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployRollback, projectId, targetId, toCommitSha, runId),
    drift: (projectId: string, targetId: string) =>
      ipcRenderer.invoke(DesktopIpcChannels.deployDrift, projectId, targetId),
    history: (projectId: string) => ipcRenderer.invoke(DesktopIpcChannels.deployHistory, projectId),
  },
  update: {
    onStatus: (listener: (status: UpdateStatus) => void) =>
      subscribe(DesktopIpcEvents.update, listener),
    restart: () => ipcRenderer.invoke(DesktopIpcChannels.updateRestart),
  },
  onboarding: {
    get: () => ipcRenderer.invoke(DesktopIpcChannels.onboardingGet),
    set: (input: OnboardingStateInput) =>
      ipcRenderer.invoke(DesktopIpcChannels.onboardingSet, input),
  },
  logs: {
    info: () => ipcRenderer.invoke(DesktopIpcChannels.logsInfo),
    report: (report: RendererErrorReport) =>
      ipcRenderer.invoke(DesktopIpcChannels.logsReport, report),
    tail: (lines: number) => ipcRenderer.invoke(DesktopIpcChannels.logsTail, lines),
    openFolder: () => ipcRenderer.invoke(DesktopIpcChannels.logsOpen),
  },
  events: {
    onAgentEvent: (listener: (message: AgentEventMessage) => void) =>
      subscribe(DesktopIpcEvents.agent, listener),
    onPreviewEvent: (listener: (message: PreviewEventMessage) => void) =>
      subscribe(DesktopIpcEvents.preview, listener),
    onCheckpoints: (listener: (message: CheckpointsMessage) => void) =>
      subscribe(DesktopIpcEvents.checkpoints, listener),
    onDeployProgress: (listener: (message: DeployProgressMessage) => void) =>
      subscribe(DesktopIpcEvents.deploy, listener),
    onDeployTargets: (listener: (message: DeployTargetsMessage) => void) =>
      subscribe(DesktopIpcEvents.targets, listener),
  },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
