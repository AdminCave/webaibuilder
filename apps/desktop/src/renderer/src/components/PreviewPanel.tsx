import { useMemo } from 'react';

import type { Theme } from '../App';

interface PreviewPanelProps {
  theme: Theme;
}

/**
 * Platzhalter-Inhalt fürs sandboxed iframe. Ab M1 zeigt das iframe den
 * loopback-Preview-Server (127.0.0.1 + Token) aus packages/preview.
 */
function placeholderDoc(theme: Theme): string {
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
  <div class="card"><strong>Noch keine Vorschau</strong>
  Die Live-Vorschau startet, sobald dein erstes Projekt angelegt ist.</div>
</body></html>`;
}

export function PreviewPanel({ theme }: PreviewPanelProps): React.JSX.Element {
  const doc = useMemo(() => placeholderDoc(theme), [theme]);

  return (
    <section className="panel panel--preview" aria-label="Vorschau">
      <header className="panel__header">
        <h1 className="panel__title">Vorschau</h1>
        <span className="chip">127.0.0.1:—</span>
        <div className="panel__header-actions">
          <button type="button" className="btn" disabled title="Verfügbar, sobald die Vorschau läuft">
            Neu laden
          </button>
        </div>
      </header>
      <iframe
        className="preview__frame"
        title="Live-Vorschau"
        sandbox=""
        srcDoc={doc}
      />
    </section>
  );
}
