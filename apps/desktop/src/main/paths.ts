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

/** Cache der zuletzt geladenen Remote-Kill-Switch-Config (M4, PLAN §3). */
export function killSwitchCacheFilePath(): string {
  return join(app.getPath('userData'), 'backends-cache.json');
}

/** Persistierte Bestätigungen der Backend-Hinweise (M4, Claude-Abo-Ack). */
export function backendAcksFilePath(): string {
  return join(app.getPath('userData'), 'backend-acks.json');
}

/**
 * URL der AdminCave-gehosteten `backends.json` für den Remote-Kill-Switch
 * (PLAN §3 Regel 3). Über `WAB_BACKENDS_CONFIG_URL` überschreibbar. Der Abruf ist
 * fail-safe (Netzfehler → Cache → gebündelter Default) und blockiert nie den
 * Start. Platzhalter-Default, final in M5 zu setzen.
 */
export function backendsConfigUrl(): string {
  return process.env['WAB_BACKENDS_CONFIG_URL'] ?? 'https://updates.admincave.dev/webaibuilder/backends.json';
}
