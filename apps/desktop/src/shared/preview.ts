/**
 * Renderer-taugliche Spiegelung von `PreviewEvent` aus @webaibuilder/preview.
 *
 * Warum spiegeln statt importieren: `@webaibuilder/preview` re-exportiert neben
 * den Typen auch `startPreviewServer` (node:http, ws, chokidar). Würde der
 * Renderer (tsconfig.web, ohne `node`-Typen) den Paket-Einstieg importieren,
 * zöge tsc dessen node-Module in die Typprüfung und scheiterte. Diese Datei ist
 * umgebungsneutral und wird von main, preload und renderer gleichermaßen
 * genutzt; der Main-Prozess prüft die Strukturgleichheit zur Compile-Zeit
 * gegen den echten Preview-Typ (siehe appSession.ts).
 */

export type PreviewConsoleLevel = 'log' | 'info' | 'warn' | 'error';

/**
 * Events aus Watcher und Injection-Shim (PLAN §4, Live-Preview).
 * `page-error` speist den „Fehler beheben"-Button im Chat.
 */
export type WabPreviewEvent =
  | { type: 'reload'; changedPaths: string[] }
  | { type: 'page-console'; level: PreviewConsoleLevel; text: string }
  | { type: 'page-error'; message: string; stack?: string; source?: string };
