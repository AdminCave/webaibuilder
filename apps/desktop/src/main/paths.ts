/**
 * Electron-abhängige Pfad-Auflösung für die Registry — bewusst getrennt von
 * registry.ts, damit die Registry-Logik headless (vitest, ohne Electron)
 * testbar bleibt. Dieser Teil wird nur zur App-Laufzeit ausgeführt.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { app } from 'electron';

import { WORKSPACE_ROOT_DIRNAME } from '@webaibuilder/core';

import type { ProjectRegistryOptions } from './registry';

/** Vorlagen: im Dev-Modus `apps/desktop/resources/templates`, im gepackten
 *  Build `<resources>/templates` (electron-builder: extraResources, M5). */
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

/** Pfad der secret-freien Backend-Einstellungen (M2). */
export function settingsFilePath(): string {
  return join(app.getPath('userData'), 'agent-settings.json');
}

/** Pfad der Deploy-Historie (append-only JSON-Log, M3). */
export function deployHistoryFilePath(): string {
  return join(app.getPath('userData'), 'deploy-history.json');
}
