/**
 * Live-Preview (PLAN §4): eigener ~200-Zeilen-Static-Server + chokidar +
 * WebSocket-Reload; Injection-Middleware fügt Reload-Client und
 * Console/Error-Shim in jede Seite ein.
 *
 * Sicherheit: loopback-only (127.0.0.1) mit Random-Port + Token — die Preview
 * rendert KI-generiertes HTML/JS und ist unsere größte Angriffsfläche.
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
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
