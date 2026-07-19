/**
 * Live preview (PLAN §4): custom ~200-line static server + chokidar +
 * WebSocket reload; injection middleware adds the reload client and
 * console/error shim to every page.
 *
 * Security: loopback-only (127.0.0.1) with a random port + token — the preview
 * renders AI-generated HTML/JS and is our largest attack surface.
 * Electron-free — this package must never import `electron`.
 */

export type {
  PageConsoleLevel,
  PreviewEvent,
  PreviewEventListener,
  PreviewEventStream,
  PreviewServerHandle,
  PreviewServerOptions,
} from './types';
export { startPreviewServer } from './server';
export { RELOAD_MARKER, SHIM_MARKER, WS_PATH } from './shim';
