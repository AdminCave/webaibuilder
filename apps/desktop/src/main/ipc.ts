/**
 * IPC-Registrierung im Main-Prozess — typisiert gegen die Kanal-Registry aus
 * packages/core, jeder Handler hinter der Sender-Validierung.
 */

import { app, ipcMain, shell } from 'electron';

import { detectBackends } from '@webaibuilder/agents';
import type { IpcArgs, IpcChannel, IpcResult } from '@webaibuilder/core';
import { IpcChannels } from '@webaibuilder/core';

import { currentSha } from '@webaibuilder/versioning';

import { isAllowedExternalUrl } from '../shared/backends';
import {
  DesktopIpcChannels,
  type DesktopIpcArgs,
  type DesktopIpcChannel,
  type DesktopIpcResult,
} from '../shared/channels';
import { initAppSession } from './appSession';
import { BackendService, FileAckStore } from './backendService';
import { realDeployEngine } from './deployEngine';
import { DeployHistoryStore } from './deployHistory';
import { DeployService } from './deployService';
import { DeployTargetService } from './deployTargets';
import { KillSwitchStore } from './killSwitch';
import {
  backendAcksFilePath,
  backendsConfigUrl,
  defaultRegistryOptions,
  deployHistoryFilePath,
  killSwitchCacheFilePath,
  settingsFilePath,
} from './paths';
import { initProjectRegistry } from './registry';
import { getSecretsService } from './secrets';
import { isTrustedIpcSender } from './security';
import { applySettingsUpdate, AgentSettingsStore } from './settingsStore';

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
  // Secrets (API-Keys, später Deploy-Credentials) laufen über den
  // OS-Schlüsselbund; der Store hält nur die secret-freien Einstellungen.
  const secrets = getSecretsService();
  const settings = new AgentSettingsStore(settingsFilePath(), secrets);
  const session = initAppSession(registry, settings);

  // --- M3: Deploy-Ziele, Deploy-Orchestrierung, Historie ---
  const deployTargets = new DeployTargetService(registry, secrets);
  const deployHistory = new DeployHistoryStore(deployHistoryFilePath());
  const deploy = new DeployService({
    registry,
    targets: deployTargets,
    history: deployHistory,
    engine: realDeployEngine,
    currentSha,
    emitProgress: (message) => session.pushDeployProgress(message),
    emitTargets: (message) => session.pushDeployTargets(message),
  });

  // --- M4: Backend-Erkennung + Remote-Kill-Switch (PLAN §3/§4) ---
  const killSwitch = new KillSwitchStore({
    cacheFilePath: killSwitchCacheFilePath(),
    remoteUrl: backendsConfigUrl(),
  });
  // Fire-and-forget: blockiert NIE den Start; fail-safe (Cache → Default).
  killSwitch.refreshInBackground();
  const backends = new BackendService({
    // Lose typisiert übernommen — resilient gegen additive Änderungen an
    // BackendAvailability in @webaibuilder/agents (paralleler Umbau).
    detect: () => detectBackends(),
    killSwitch,
    acks: new FileAckStore(backendAcksFilePath()),
  });

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
  // Abo-Backends dürfen nur aktiv werden, wenn sie nach Erkennung + Kill-Switch +
  // Bestätigung nutzbar sind — der Main-Prozess erzwingt das autoritativ.
  handleDesktop(DesktopIpcChannels.settingsSet, (input) =>
    applySettingsUpdate(settings, backends, input),
  );

  // --- M3: Deploy-Ziel-CRUD + Deploy/Rollback/Test/Drift/Historie ---
  handleDesktop(DesktopIpcChannels.deployTargetsList, (projectId) => deployTargets.list(projectId));
  handleDesktop(DesktopIpcChannels.deployTargetsSave, (projectId, input) =>
    deployTargets.save(projectId, input),
  );
  handleDesktop(DesktopIpcChannels.deployTargetsDelete, (projectId, targetId) =>
    deployTargets.delete(projectId, targetId),
  );
  handleDesktop(DesktopIpcChannels.deployTest, (projectId, targetId) =>
    deploy.testConnection(projectId, targetId),
  );
  handleDesktop(DesktopIpcChannels.deployRun, (projectId, targetId, runId) =>
    deploy.run(projectId, targetId, runId),
  );
  handleDesktop(DesktopIpcChannels.deployRollback, (projectId, targetId, toCommitSha, runId) =>
    deploy.rollback(projectId, targetId, toCommitSha, runId),
  );
  handleDesktop(DesktopIpcChannels.deployDrift, (projectId, targetId) =>
    deploy.drift(projectId, targetId),
  );
  handleDesktop(DesktopIpcChannels.deployHistory, (projectId) => deploy.listHistory(projectId));

  // --- M4: Backend-Erkennung, Kill-Switch-Merge, Bestätigung, Onboarding-Links ---
  handleDesktop(DesktopIpcChannels.backendsList, () => backends.availability());
  handleDesktop(DesktopIpcChannels.backendsRefresh, () => backends.refresh());
  handleDesktop(DesktopIpcChannels.backendsAck, (backendId) => backends.acknowledge(backendId));
  handleDesktop(DesktopIpcChannels.backendsOpenHint, async (url) => {
    // Nur offizielle Vendor-Domains (https) öffnen — nie eine beliebige URL.
    if (!isAllowedExternalUrl(url)) return { opened: false };
    await shell.openExternal(url);
    return { opened: true };
  });
}
