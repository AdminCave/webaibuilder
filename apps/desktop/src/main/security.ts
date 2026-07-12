/**
 * Security-Hardening (PLAN §4, Sicherheit): deny-by-default für Navigation,
 * Fenster-Öffnung und Browser-Permissions; IPC-Sender-Validierung.
 */

import { app, session } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';

/** Dev-Server-URL, die electron-vite im Dev-Modus setzt. */
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

/** Erlaubt ist ausschließlich der eigene Renderer (Dev-Server bzw. file://). */
function isAllowedNavigation(url: string): boolean {
  const dev = devRendererUrl();
  if (!app.isPackaged && dev !== undefined) return sameOrigin(url, dev);
  // Produktion lädt per loadFile; jede will-navigate-Navigation ist fremd.
  return false;
}

/** Deny-by-default-Härtung für JEDEN WebContents (auch künftige). */
export function hardenWebContents(contents: WebContents): void {
  // Keine neuen Fenster — egal wohin.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Keine Navigation raus aus unserem Renderer.
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });

  // Keine <webview>-Tags.
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * Browser-Permissions: M0 braucht keine einzige — alles ablehnen.
 * TODO(M1): prüfen, ob die Preview z. B. `fullscreen` braucht; dann gezielt
 * pro Permission + Origin freigeben, nie pauschal.
 */
export function installPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/**
 * IPC-Sender-Validierung: nur der Haupt-Frame unseres eigenen Renderers darf
 * IPC aufrufen (kein iframe, kein fremder Origin).
 */
export function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (frame === null) return false;
  if (frame !== event.sender.mainFrame) return false;

  const dev = devRendererUrl();
  if (!app.isPackaged && dev !== undefined) return sameOrigin(frame.url, dev);
  return frame.url.startsWith('file://');
}
