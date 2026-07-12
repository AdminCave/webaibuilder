import { useMemo, useState } from 'react';

import type { Theme } from '../App';

interface PreviewPanelProps {
  theme: Theme;
  /** Vollständige Preview-URL inkl. Token, oder null (startet noch / Fehler). */
  previewUrl: string | null;
  port: number | null;
  status: 'opening' | 'ready' | 'error';
  openError: string | null;
}

/** Platzhalter-Inhalt, solange keine Preview-URL vorliegt. */
function placeholderDoc(theme: Theme, message: string): string {
  const bg = theme === 'dark' ? '#000000' : '#ffffff';
  const text = theme === 'dark' ? '#ededee' : '#16181c';
  const muted = theme === 'dark' ? '#9aa1a8' : '#565c64';
  const border = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:${bg};color:${muted};
    font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;text-align:center;padding:24px}
  .card{border:1px solid ${border};border-radius:16px;padding:24px 28px;max-width:340px}
  strong{display:block;color:${text};font-weight:600;margin-bottom:6px}
</style></head><body>
  <div class="card"><strong>Vorschau</strong>${message}</div>
</body></html>`;
}

export function PreviewPanel({
  theme,
  previewUrl,
  port,
  status,
  openError,
}: PreviewPanelProps): React.JSX.Element {
  const [reloadNonce, setReloadNonce] = useState(0);

  const placeholderMessage =
    status === 'error'
      ? (openError ?? 'Die Vorschau konnte nicht starten.')
      : 'Die Live-Vorschau startet …';
  const doc = useMemo(() => placeholderDoc(theme, placeholderMessage), [theme, placeholderMessage]);

  const portLabel = port === null ? '127.0.0.1:—' : `127.0.0.1:${port}`;

  return (
    <section className="panel panel--preview" aria-label="Vorschau">
      <header className="panel__header">
        <h1 className="panel__title">Vorschau</h1>
        <span className="chip">{portLabel}</span>
        <div className="panel__header-actions">
          <button
            type="button"
            className="btn"
            disabled={previewUrl === null}
            title="Vorschau neu laden"
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            Neu laden
          </button>
        </div>
      </header>
      {previewUrl === null ? (
        <iframe className="preview__frame" title="Live-Vorschau" sandbox="" srcDoc={doc} />
      ) : (
        <iframe
          // Remount erzwingt einen harten Reload; die Auto-Reload-Verbindung
          // (WebSocket-Shim aus packages/preview) läuft unabhängig weiter.
          key={reloadNonce}
          className="preview__frame"
          title="Live-Vorschau"
          // allow-scripts: die KI-Seite enthält JS + den Reload-/Fehler-Shim.
          // allow-same-origin: der loopback-Origin ist token-geschützt; ohne ihn
          // funktionieren Subressourcen/Storage der Seite nicht zuverlässig.
          sandbox="allow-scripts allow-same-origin"
          src={previewUrl}
        />
      )}
    </section>
  );
}
