/**
 * Error reporting in the main process (M5, PLAN §1/§6).
 *
 * Installs the robust, LOCAL error/log capture:
 *  - Node: `process.on('uncaughtException' | 'unhandledRejection')`.
 *  - Electron `app`: `render-process-gone` (renderer crash) + `child-process-gone`.
 *  - Renderer console: `webContents` 'console-message' (error level only).
 *  - Renderer JS errors additionally come in via the typed IPC channel
 *    `logs:report` (see {@link logRendererError}, wired up in ipc.ts).
 *
 * Everything ends up exclusively in the local rotating log file (logger.ts).
 *
 * Stance (PLAN §1, GDPR/local-first): **no remote.** There is deliberately no
 * HTTP/telemetry code and no endpoint here. An optional remote-report path
 * would be a later, explicitly opt-in addition to build:
 *   TODO(v1.1, opt-in): If a remote crash report is ever desired, it must be
 *   OFF by default, clearly consent-gated, and secret-free. NO endpoint, no
 *   auto-upload — that would contradict the local-first positioning.
 */

import { app } from 'electron';
import type { WebContents } from 'electron';

import type { RendererErrorReport } from '../shared/logging';
import type { FileLogger } from './logger';

/** Describes an unknown reason/error briefly and with minimal secrets. */
function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message, ...(value.stack !== undefined ? { stack: value.stack } : {}) };
  }
  return { message: String(value) };
}

/** Attaches console capture (error level only) to a WebContents. */
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
 * Installs all main-process error hooks. Idempotent: a repeated call registers
 * the listeners only once. Safe to call before `app.whenReady()` — the Node
 * hooks take effect immediately, the `app` hooks as soon as Electron fires them.
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
    logger.error('render-process-gone', `Renderer terminated: ${details.reason}`, {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  app.on('child-process-gone', (_event, details) => {
    logger.error('child-process-gone', `Child process terminated: ${details.type}`, {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName,
    });
  });

  app.on('web-contents-created', (_event, contents) => attachConsoleCapture(logger, contents));

  logger.info('main', 'Error reporting active — local, no remote (PLAN §1).', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  });
}

/**
 * Writes a renderer error reported from the sandbox into the local log. Called
 * by the IPC handler `logs:report`. The context is scrubbed by the logger (as
 * everywhere).
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
