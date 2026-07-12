/**
 * Öffentliche Typen des Preview-Pakets (PLAN §4, Live-Preview).
 *
 * Hinweis: `PreviewEvent` lebt hier (nicht in @webaibuilder/core) — core kennt
 * nur den Agent-Event-Strom; Datei-Änderungen und Seiten-Events kommen per
 * Strukturregel aus diesem Paket.
 */

export interface PreviewServerOptions {
  /** Absoluter Pfad des Docroot (`<workspace>/site`), das ausgeliefert wird. */
  siteDir: string;
  /**
   * Bind-Adresse. Sicherheits-Hardregel (PLAN §4, Sicherheit): nur loopback —
   * alles außer `127.0.0.1` wird abgelehnt.
   * @default '127.0.0.1'
   */
  host?: string;
  /**
   * Entprellung des Datei-Watchers in Millisekunden: schnelle Änderungsserien
   * werden zu einem Reload zusammengefasst.
   * @default 100
   */
  debounceMs?: number;
  /** Listener für Reload-, Console- und Fehler-Events der Seite. */
  onEvent?: PreviewEventListener;
}

/** Laufende Preview-Instanz. */
export interface PreviewServerHandle {
  /** Vollständige URL fürs iframe: `http://127.0.0.1:<port>/?wab=<token>`. */
  url: string;
  port: number;
  /** Zugriffstoken — Requests ohne Token werden abgewiesen. */
  token: string;
  /** Event-Strom: Listener-API und async-iterierbar (`for await`). */
  events: PreviewEventStream;
  /** Fährt HTTP-Server, WebSocket-Server und Watcher sauber herunter. */
  close(): Promise<void>;
}

export type PageConsoleLevel = 'log' | 'info' | 'warn' | 'error';

/**
 * Events aus Watcher und Injection-Shim. `page-error` speist den
 * "Fehler beheben"-Button im Chat (PLAN §4, Live-Preview).
 */
export type PreviewEvent =
  | { type: 'reload'; changedPaths: string[] }
  | { type: 'page-console'; level: PageConsoleLevel; text: string }
  | { type: 'page-error'; message: string; stack?: string; source?: string };

export type PreviewEventListener = (event: PreviewEvent) => void;

/** Abonnierbarer Event-Strom — Listener-API plus async Iteration. */
export interface PreviewEventStream extends AsyncIterable<PreviewEvent> {
  /** Registriert einen Listener; die Rückgabe meldet ihn wieder ab. */
  on(listener: PreviewEventListener): () => void;
  off(listener: PreviewEventListener): void;
}
