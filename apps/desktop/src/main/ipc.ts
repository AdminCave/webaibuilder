/**
 * IPC registration in the main process — typed against the channel registry from
 * packages/core, with every handler behind sender validation.
 */

import { app, ipcMain, shell } from 'electron';

import { detectBackends, makeLoginProbe } from '@webaibuilder/agents';
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
import { validateIpcArgs } from './ipcSchemas';
import { realDeployEngine } from './deployEngine';
import { DeployHistoryStore } from './deployHistory';
import { DeployService } from './deployService';
import { DeployTargetService } from './deployTargets';
import { logRendererError } from './errorReporting';
import { KillSwitchStore } from './killSwitch';
import { getLogger } from './logger';
import { OnboardingStore } from './onboardingStore';
import {
  backendAcksFilePath,
  backendsConfigUrl,
  defaultRegistryOptions,
  deployHistoryFilePath,
  killSwitchCacheFilePath,
  onboardingStateFilePath,
  settingsFilePath,
} from './paths';
import { initProjectRegistry } from './registry';
import { getSecretsService } from './secrets';
import { isTrustedIpcSender } from './security';
import { applySettingsUpdate, AgentSettingsStore } from './settingsStore';

/**
 * Shared guard before every handler: (1) sender validation — only our own
 * main frame; (2) payload validation against the zod schemas (defense-in-depth,
 * see ipcSchemas.ts). Malformed payloads are logged and rejected BEFORE they
 * reach a service.
 */
function guardIpc(channel: string, event: Electron.IpcMainInvokeEvent, args: unknown[]): void {
  if (!isTrustedIpcSender(event)) {
    throw new Error(`IPC call on "${channel}" blocked from an untrusted sender.`);
  }
  const issue = validateIpcArgs(channel, args);
  if (issue !== null) {
    try {
      getLogger().warn('ipc', `Invalid arguments on "${channel}"`, { issue });
    } catch {
      /* Logger not yet initialized — rejection is enough. */
    }
    throw new Error(`Invalid request to "${channel}".`);
  }
}

/** `ipcMain.handle` with types from the IpcInvokeMap + sender/payload validation. */
function handle<C extends IpcChannel>(
  channel: C,
  handler: (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    guardIpc(channel, event, args);
    return handler(...(args as IpcArgs<C>));
  });
}

/** Like {@link handle}, but for the desktop-local M2 channels. */
function handleDesktop<C extends DesktopIpcChannel>(
  channel: C,
  handler: (...args: DesktopIpcArgs<C>) => DesktopIpcResult<C> | Promise<DesktopIpcResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    guardIpc(channel, event, args);
    return handler(...(args as DesktopIpcArgs<C>));
  });
}

export function registerIpcHandlers(): void {
  // Opens the SQLite DB exactly once per app run (userData is only reliable
  // after app.whenReady() — registerIpcHandlers runs after that).
  const registry = initProjectRegistry(defaultRegistryOptions());
  // Secrets (API keys, later deploy credentials) go through the OS keychain;
  // the store holds only the secret-free settings.
  const secrets = getSecretsService();
  // Pass process.env through explicitly: enables the env-key fallback
  // (ANTHROPIC_API_KEY & co.) without tests depending on the real env.
  const settings = new AgentSettingsStore(settingsFilePath(), secrets, process.env);
  const session = initAppSession(registry, settings);

  // --- M3: deploy targets, deploy orchestration, history ---
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

  // --- M4: backend detection + remote kill switch (PLAN §3/§4) ---
  const killSwitch = new KillSwitchStore({
    cacheFilePath: killSwitchCacheFilePath(),
    remoteUrl: backendsConfigUrl(),
  });
  // Fire-and-forget: NEVER blocks startup; fail-safe (cache → default).
  killSwitch.refreshInBackground();
  const backends = new BackendService({
    // Taken loosely typed — resilient against additive changes to
    // BackendAvailability in @webaibuilder/agents (parallel refactor).
    // Login probe: asks the official CLI, without side effects, for its login
    // status ("logged in as …" instead of a perpetual "found", PLAN §6).
    detect: () => detectBackends({ probe: makeLoginProbe() }),
    killSwitch,
    acks: new FileAckStore(backendAcksFilePath()),
  });

  // --- M5: first-run onboarding + local error reports/logs ---
  const onboarding = new OnboardingStore(onboardingStateFilePath());

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

  // --- M2: session / chat / checkpoints / settings ---
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
  // Subscription backends may only become active if they are usable after
  // detection + kill switch + acknowledgment — the main process enforces this authoritatively.
  handleDesktop(DesktopIpcChannels.settingsSet, (input) =>
    applySettingsUpdate(settings, backends, input),
  );

  // --- M3: deploy-target CRUD + deploy/rollback/test/drift/history ---
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

  // --- M4: backend detection, kill-switch merge, acknowledgment, onboarding links ---
  handleDesktop(DesktopIpcChannels.backendsList, () => backends.availability());
  handleDesktop(DesktopIpcChannels.backendsRefresh, () => backends.refresh());
  handleDesktop(DesktopIpcChannels.backendsAck, (backendId) => backends.acknowledge(backendId));
  handleDesktop(DesktopIpcChannels.backendsOpenHint, async (url) => {
    // Only open official vendor domains (https) — never an arbitrary URL.
    if (!isAllowedExternalUrl(url)) return { opened: false };
    await shell.openExternal(url);
    return { opened: true };
  });

  // --- M5: onboarding state ---
  handleDesktop(DesktopIpcChannels.onboardingGet, () => onboarding.get());
  handleDesktop(DesktopIpcChannels.onboardingSet, (input) => onboarding.set(input));

  // --- M5: local error reports & logs (no remote, PLAN §1) ---
  handleDesktop(DesktopIpcChannels.logsInfo, () => {
    const logger = getLogger();
    return { dir: logger.dir, file: logger.filePath };
  });
  handleDesktop(DesktopIpcChannels.logsReport, (report) => {
    logRendererError(getLogger(), report);
  });
  handleDesktop(DesktopIpcChannels.logsTail, (lines) => ({ text: getLogger().tail(lines) }));
  handleDesktop(DesktopIpcChannels.logsOpen, async () => {
    // shell.openPath opens the folder in the file manager; '' = success.
    const error = await shell.openPath(getLogger().dir);
    return { opened: error === '' };
  });
}
