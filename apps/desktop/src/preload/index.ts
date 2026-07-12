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
  type DesktopIpcEvent,
  type DesktopIpcEventPayload,
  type PreviewEventMessage,
} from '../shared/channels';
import {
  WAB_DESKTOP_BRIDGE_VERSION,
  type Unsubscribe,
  type WabDesktopBridge,
} from '../shared/bridge';
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
  events: {
    onAgentEvent: (listener: (message: AgentEventMessage) => void) =>
      subscribe(DesktopIpcEvents.agent, listener),
    onPreviewEvent: (listener: (message: PreviewEventMessage) => void) =>
      subscribe(DesktopIpcEvents.preview, listener),
    onCheckpoints: (listener: (message: CheckpointsMessage) => void) =>
      subscribe(DesktopIpcEvents.checkpoints, listener),
  },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
