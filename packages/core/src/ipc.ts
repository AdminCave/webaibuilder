/**
 * Typed IPC channel registry — the SINGLE source for channel names,
 * shared between the main process and preload/renderer.
 *
 * Convention: `wab:v<version>:<domain>:<action>`.
 */

import type { Project, ProjectCreateInput, ProjectUpdateInput, StarterTemplate } from './project';

export const IpcChannels = {
  ping: 'wab:v1:ping',
  projectsList: 'wab:v1:projects:list',
  projectsGet: 'wab:v1:projects:get',
  projectsCreate: 'wab:v1:projects:create',
  projectsUpdate: 'wab:v1:projects:update',
  projectsDelete: 'wab:v1:projects:delete',
  templatesList: 'wab:v1:templates:list',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** Response of the ping channel — proves the bridge is up. */
export interface PingResult {
  ok: true;
  time: string;
  versions: {
    app: string;
    electron: string;
    chrome: string;
    node: string;
  };
}

/**
 * Request/response contract per channel. Main (`ipcMain.handle`) and preload
 * (`ipcRenderer.invoke`) both type themselves against this map.
 */
export interface IpcInvokeMap {
  [IpcChannels.ping]: { args: []; result: PingResult };
  [IpcChannels.projectsList]: { args: []; result: Project[] };
  [IpcChannels.projectsGet]: { args: [id: string]; result: Project | null };
  [IpcChannels.projectsCreate]: { args: [input: ProjectCreateInput]; result: Project };
  [IpcChannels.projectsUpdate]: {
    args: [id: string, patch: ProjectUpdateInput];
    result: Project;
  };
  [IpcChannels.projectsDelete]: { args: [id: string]; result: void };
  [IpcChannels.templatesList]: { args: []; result: StarterTemplate[] };
}

export type IpcArgs<C extends IpcChannel> = IpcInvokeMap[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcInvokeMap[C]['result'];
