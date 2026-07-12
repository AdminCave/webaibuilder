/**
 * Fehlerberichte im Main-Prozess (M5, PLAN §1/§6).
 *
 * Installiert die robuste, LOKALE Fehler-/Log-Erfassung:
 *  - Node: `process.on('uncaughtException' | 'unhandledRejection')`.
 *  - Electron-`app`: `render-process-gone` (Renderer-Crash) + `child-process-gone`.
 *  - Renderer-Konsole: `webContents` 'console-message' (nur error-Level).
 *  - Renderer-JS-Fehler kommen zusätzlich über den typisierten IPC-Kanal
 *    `logs:report` herein (siehe {@link logRendererError}, verdrahtet in ipc.ts).
 *
 * Alles landet ausschließlich in der lokalen rotierenden Log-Datei (logger.ts).
 *
 * Haltung (PLAN §1, DSGVO/Local-first): **kein Remote.** Es gibt hier bewusst
 * keinen HTTP-/Telemetrie-Code und keinen Endpunkt. Ein optionaler
 * Remote-Report-Pfad wäre ein späterer, ausdrücklich opt-in zu bauender Zusatz:
 *   TODO(v1.1, opt-in): Falls je ein Remote-Crash-Report gewünscht ist, muss er
 *   standardmäßig AUS sein, klar zustimmungspflichtig und secret-frei. KEIN
 *   Endpunkt, kein Auto-Upload — das widerspräche der Local-first-Positionierung.
 */

import { app } from 'electron';
import type { WebContents } from 'electron';

import type { RendererErrorReport } from '../shared/logging';
import type { FileLogger } from './logger';

/** Beschreibt einen unbekannten Grund/Fehler kurz und secret-arm. */
function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message, ...(value.stack !== undefined ? { stack: value.stack } : {}) };
  }
  return { message: String(value) };
}

/** Hängt die Konsolen-Erfassung (nur error-Level) an einen WebContents. */
function attachConsoleCapture(logger: FileLogger, contents: WebContents): void {
  contents.on('console-message', (details) => {
    if (details.level !== 'error') return;
    logger.warn('renderer-console', details.message, {
      line: details.lineNumber,
      source: details.sourceId,
    });
  });
}

/**
 * Installiert alle Main-Prozess-Fehler-Hooks. Idempotent: mehrfacher Aufruf
 * registriert die Listener nur einmal. Sicher vor `app.whenReady()` aufrufbar —
 * die Node-Hooks greifen sofort, die `app`-Hooks sobald Electron sie feuert.
 */
let installed = false;

export function installErrorReporting(logger: FileLogger): void {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (error, origin) => {
    const { message, stack } = describe(error);
    logger.error('uncaughtException', message, { origin, stack });
  });

  process.on('unhandledRejection', (reason) => {
    const { message, stack } = describe(reason);
    logger.error('unhandledRejection', message, { stack });
  });

  app.on('render-process-gone', (_event, _webContents, details) => {
    logger.error('render-process-gone', `Renderer beendet: ${details.reason}`, {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  app.on('child-process-gone', (_event, details) => {
    logger.error('child-process-gone', `Kindprozess beendet: ${details.type}`, {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName,
    });
  });

  app.on('web-contents-created', (_event, contents) => attachConsoleCapture(logger, contents));

  logger.info('main', 'Fehlerberichte aktiv — lokal, kein Remote (PLAN §1).', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  });
}

/**
 * Schreibt einen aus der Sandbox gemeldeten Renderer-Fehler ins lokale Log.
 * Vom IPC-Handler `logs:report` aufgerufen. Der Kontext wird (wie überall) vom
 * Logger gescrubbt.
 */
export function logRendererError(logger: FileLogger, report: RendererErrorReport): void {
  logger.error('renderer', report.message, {
    kind: report.kind,
    stack: report.stack,
    source: report.source,
    line: report.line,
    column: report.column,
  });
}
