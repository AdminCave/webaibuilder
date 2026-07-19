/**
 * Electron-dependent path resolution for the registry — deliberately separated
 * from registry.ts so the registry logic stays headless (vitest, without
 * Electron) testable. This part runs only at app runtime.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { app } from 'electron';

import { WORKSPACE_ROOT_DIRNAME } from '@webaibuilder/core';

import type { ProjectRegistryOptions } from './registry';

/** Templates: in dev mode `apps/desktop/resources/templates`, in the packaged
 *  build `<resources>/templates` (electron-builder: extraResources, M5). */
function templatesRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'templates')
    : join(app.getAppPath(), 'resources', 'templates');
}

export function defaultRegistryOptions(): ProjectRegistryOptions {
  return {
    dbPath: join(app.getPath('userData'), 'webaibuilder.db'),
    workspaceRoot: join(homedir(), WORKSPACE_ROOT_DIRNAME),
    templatesRoot: templatesRoot(),
  };
}

/** Path of the secret-free backend settings (M2). */
export function settingsFilePath(): string {
  return join(app.getPath('userData'), 'agent-settings.json');
}

/** Path of the deploy history (append-only JSON log, M3). */
export function deployHistoryFilePath(): string {
  return join(app.getPath('userData'), 'deploy-history.json');
}

/** Cache of the last loaded remote kill-switch config (M4, PLAN §3). */
export function killSwitchCacheFilePath(): string {
  return join(app.getPath('userData'), 'backends-cache.json');
}

/** Persisted acknowledgments of the backend notices (M4, Claude subscription ack). */
export function backendAcksFilePath(): string {
  return join(app.getPath('userData'), 'backend-acks.json');
}

/** State of the first-run onboarding (M5, `hasOnboarded` flag). */
export function onboardingStateFilePath(): string {
  return join(app.getPath('userData'), 'onboarding-state.json');
}

/** Directory of the rotating log files (M5, error reports — local). */
export function logsDir(): string {
  return join(app.getPath('userData'), 'logs');
}

/**
 * URL of the AdminCave-hosted `backends.json` for the remote kill switch
 * (PLAN §3 rule 3). Overridable via `WAB_BACKENDS_CONFIG_URL`. The fetch is
 * fail-safe (network error → cache → bundled default) and never blocks startup.
 * Placeholder default, to be finalized in M5.
 */
export function backendsConfigUrl(): string {
  return process.env['WAB_BACKENDS_CONFIG_URL'] ?? 'https://updates.admincave.dev/webaibuilder/backends.json';
}
