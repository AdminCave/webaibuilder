/**
 * Public types of the preview package (PLAN §4, live preview).
 *
 * Note: `PreviewEvent` lives here (not in @webaibuilder/core) — core knows
 * only the agent event stream; file changes and page events come from this
 * package by structural rule.
 */

export interface PreviewServerOptions {
  /** Absolute path of the docroot (`<workspace>/site`) that is served. */
  siteDir: string;
  /**
   * Bind address. Hard security rule (PLAN §4, Security): loopback only —
   * anything other than `127.0.0.1` is rejected.
   * @default '127.0.0.1'
   */
  host?: string;
  /**
   * Debounce of the file watcher in milliseconds: rapid bursts of changes
   * are coalesced into a single reload.
   * @default 100
   */
  debounceMs?: number;
  /** Listener for reload, console and error events of the page. */
  onEvent?: PreviewEventListener;
}

/** Running preview instance. */
export interface PreviewServerHandle {
  /** Full URL for the iframe: `http://127.0.0.1:<port>/?wab=<token>`. */
  url: string;
  port: number;
  /** Access token — requests without a token are rejected. */
  token: string;
  /** Event stream: listener API and async-iterable (`for await`). */
  events: PreviewEventStream;
  /** Cleanly shuts down HTTP server, WebSocket server and watcher. */
  close(): Promise<void>;
}

export type PageConsoleLevel = 'log' | 'info' | 'warn' | 'error';

/**
 * Events from the watcher and injection shim. `page-error` feeds the
 * "Fix error" button in the chat (PLAN §4, live preview).
 */
export type PreviewEvent =
  | { type: 'reload'; changedPaths: string[] }
  | { type: 'page-console'; level: PageConsoleLevel; text: string }
  | { type: 'page-error'; message: string; stack?: string; source?: string };

export type PreviewEventListener = (event: PreviewEvent) => void;

/** Subscribable event stream — listener API plus async iteration. */
export interface PreviewEventStream extends AsyncIterable<PreviewEvent> {
  /** Registers a listener; the return value unregisters it. */
  on(listener: PreviewEventListener): () => void;
  off(listener: PreviewEventListener): void;
}
