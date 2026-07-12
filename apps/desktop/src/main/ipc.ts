/**
 * IPC-Registrierung im Main-Prozess — typisiert gegen die Kanal-Registry aus
 * packages/core, jeder Handler hinter der Sender-Validierung.
 */

import { app, ipcMain } from 'electron';

import type { IpcArgs, IpcChannel, IpcResult } from '@webaibuilder/core';
import { IpcChannels } from '@webaibuilder/core';

import {
  DesktopIpcChannels,
  type DesktopIpcArgs,
  type DesktopIpcChannel,
  type DesktopIpcResult,
} from '../shared/channels';
import { initAppSession } from './appSession';
import { defaultRegistryOptions, settingsFilePath } from './paths';
import { initProjectRegistry } from './registry';
import { isTrustedIpcSender } from './security';
import { AgentSettingsStore } from './settingsStore';

/** `ipcMain.handle` mit Typen aus der IpcInvokeMap + Sender-Validierung. */
function handle<C extends IpcChannel>(
  channel: C,
  handler: (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error(
        `IPC-Aufruf auf "${channel}" von nicht vertrauenswürdigem Absender blockiert.`,
      );
    }
    return handler(...(args as IpcArgs<C>));
  });
}

/** Wie {@link handle}, aber für die desktop-lokalen M2-Kanäle. */
function handleDesktop<C extends DesktopIpcChannel>(
  channel: C,
  handler: (...args: DesktopIpcArgs<C>) => DesktopIpcResult<C> | Promise<DesktopIpcResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error(
        `IPC-Aufruf auf "${channel}" von nicht vertrauenswürdigem Absender blockiert.`,
      );
    }
    return handler(...(args as DesktopIpcArgs<C>));
  });
}

export function registerIpcHandlers(): void {
  // Öffnet die SQLite-DB genau einmal pro App-Lauf (userData ist erst nach
  // app.whenReady() zuverlässig — registerIpcHandlers läuft danach).
  const registry = initProjectRegistry(defaultRegistryOptions());
  const settings = new AgentSettingsStore(settingsFilePath());
  const session = initAppSession(registry, settings);

  handle(IpcChannels.ping, () => ({
    ok: true,
    time: new Date().toISOString(),
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
    },
  }));

  handle(IpcChannels.projectsList, () => registry.list());
  handle(IpcChannels.projectsGet, (id) => registry.get(id));
  handle(IpcChannels.projectsCreate, (input) => registry.create(input));
  handle(IpcChannels.projectsUpdate, (id, patch) => registry.update(id, patch));
  handle(IpcChannels.projectsDelete, (id) => registry.delete(id));
  handle(IpcChannels.templatesList, () => registry.listTemplates());

  // --- M2: Session / Chat / Checkpoints / Einstellungen ---
  handleDesktop(DesktopIpcChannels.sessionOpen, (projectId) => session.openProject(projectId));
  handleDesktop(DesktopIpcChannels.sessionClose, () => session.closeProject());
  handleDesktop(DesktopIpcChannels.chatSend, (input) => session.sendChat(input.prompt, input.runId));
  handleDesktop(DesktopIpcChannels.chatInterrupt, () => session.interrupt());
  handleDesktop(DesktopIpcChannels.chatPermission, (decision) =>
    session.respondPermission(decision),
  );
  handleDesktop(DesktopIpcChannels.checkpointsList, () => session.listCheckpoints());
  handleDesktop(DesktopIpcChannels.checkpointsRestore, (id) => session.restore(id));
  handleDesktop(DesktopIpcChannels.settingsGet, () => settings.get());
  handleDesktop(DesktopIpcChannels.settingsSet, (input) => settings.set(input));
}
