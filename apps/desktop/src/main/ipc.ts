/**
 * IPC-Registrierung im Main-Prozess — typisiert gegen die Kanal-Registry aus
 * packages/core, jeder Handler hinter der Sender-Validierung.
 */

import { app, ipcMain } from 'electron';

import type { IpcArgs, IpcChannel, IpcResult } from '@webaibuilder/core';
import { IpcChannels } from '@webaibuilder/core';

import { defaultRegistryOptions } from './paths';
import { initProjectRegistry } from './registry';
import { isTrustedIpcSender } from './security';

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

export function registerIpcHandlers(): void {
  // Öffnet die SQLite-DB genau einmal pro App-Lauf (userData ist erst nach
  // app.whenReady() zuverlässig — registerIpcHandlers läuft danach).
  const registry = initProjectRegistry(defaultRegistryOptions());

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
}
