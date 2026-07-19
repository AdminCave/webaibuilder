/**
 * Renderer-friendly mirror of `PreviewEvent` from @webaibuilder/preview.
 *
 * Why mirror instead of import: `@webaibuilder/preview` re-exports, alongside the
 * types, also `startPreviewServer` (node:http, ws, chokidar). If the renderer
 * (tsconfig.web, without `node` types) imported the package entry point, tsc
 * would pull its node modules into type checking and fail. This file is
 * environment-neutral and used by main, preload, and renderer alike; the main
 * process verifies structural equality against the real preview type at compile
 * time (see appSession.ts).
 */

export type PreviewConsoleLevel = 'log' | 'info' | 'warn' | 'error';

/**
 * Events from the watcher and injection shim (PLAN §4, live preview).
 * `page-error` feeds the "Fix error" button in the chat.
 */
export type WabPreviewEvent =
  | { type: 'reload'; changedPaths: string[] }
  | { type: 'page-console'; level: PreviewConsoleLevel; text: string }
  | { type: 'page-error'; message: string; stack?: string; source?: string };
