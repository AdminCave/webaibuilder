/**
 * Preload: typisierte, versionierte, minimale Bridge (`window.wab`).
 * Läuft sandboxed — nur `electron` ist importierbar, alles andere wird
 * von electron-vite in diese Datei gebundelt.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type { ProjectCreateInput, ProjectUpdateInput, WabBridge } from '@webaibuilder/core';
import { BRIDGE_KEY, BRIDGE_VERSION, IpcChannels } from '@webaibuilder/core';

const bridge: WabBridge = {
  version: BRIDGE_VERSION,
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
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
