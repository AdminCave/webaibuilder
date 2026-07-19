/**
 * Security hardening (PLAN §4, security): deny-by-default for navigation, window
 * opening, and browser permissions; IPC sender validation.
 */

import { app, session } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';

/** Dev server URL that electron-vite sets in dev mode. */
export function devRendererUrl(): string | undefined {
  return process.env['ELECTRON_RENDERER_URL'];
}

function sameOrigin(url: string, reference: string): boolean {
  try {
    return new URL(url).origin === new URL(reference).origin;
  } catch {
    return false;
  }
}

/** Only our own renderer is allowed (dev server or file://). */
function isAllowedNavigation(url: string): boolean {
  const dev = devRendererUrl();
  if (!app.isPackaged && dev !== undefined) return sameOrigin(url, dev);
  // Production loads via loadFile; every will-navigate navigation is foreign.
  return false;
}

/** Deny-by-default hardening for EVERY WebContents (including future ones). */
export function hardenWebContents(contents: WebContents): void {
  // No new windows — no matter where.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // No navigation out of our renderer.
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });

  // No <webview> tags.
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * Browser permissions: M0 needs not a single one — deny everything.
 * TODO(M1): check whether the preview needs e.g. `fullscreen`; then grant
 * specifically per permission + origin, never wholesale.
 */
export function installPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/**
 * IPC sender validation: only the main frame of our own renderer may call IPC
 * (no iframe, no foreign origin).
 */
export function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (frame === null) return false;
  if (frame !== event.sender.mainFrame) return false;

  const dev = devRendererUrl();
  if (!app.isPackaged && dev !== undefined) return sameOrigin(frame.url, dev);
  return frame.url.startsWith('file://');
}
