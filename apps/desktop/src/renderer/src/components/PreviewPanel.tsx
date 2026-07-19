import { useMemo, useState } from 'react';

import type { Theme } from '../App';
import { Icon } from './Icon';

interface PreviewPanelProps {
  theme: Theme;
  /** Full preview URL including token, or null (still starting / error). */
  previewUrl: string | null;
  port: number | null;
  status: 'opening' | 'ready' | 'error';
  openError: string | null;
  /** Reopens the project session — restart after a preview error. */
  onRetry: () => void;
}

/** Placeholder content while no preview URL is available. */
function placeholderDoc(theme: Theme, message: string): string {
  const bg = theme === 'dark' ? '#000000' : '#ffffff';
  const text = theme === 'dark' ? '#ededee' : '#16181c';
  const muted = theme === 'dark' ? '#9aa1a8' : '#565c64';
  const border = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:${bg};color:${muted};
    font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;text-align:center;padding:24px}
  .card{border:1px solid ${border};border-radius:16px;padding:24px 28px;max-width:340px}
  strong{display:block;color:${text};font-weight:600;margin-bottom:6px}
</style></head><body>
  <div class="card"><strong>Preview</strong>${message}</div>
</body></html>`;
}

export function PreviewPanel({
  theme,
  previewUrl,
  port,
  status,
  openError,
  onRetry,
}: PreviewPanelProps): React.JSX.Element {
  const [reloadNonce, setReloadNonce] = useState(0);

  const placeholderMessage =
    status === 'error'
      ? (openError ?? 'The preview could not start.')
      : 'The live preview is starting …';
  const doc = useMemo(() => placeholderDoc(theme, placeholderMessage), [theme, placeholderMessage]);

  const portLabel = port === null ? '127.0.0.1:—' : `127.0.0.1:${port}`;

  return (
    <section className="panel panel--preview" aria-label="Preview">
      <header className="panel__header">
        <h1 className="panel__title">Preview</h1>
        <span className="chip">{portLabel}</span>
        <div className="panel__header-actions">
          {status === 'error' ? (
            // Restart path: "Reload" would be dead exactly when you need it
            // (previewUrl === null) — instead reopen the session.
            <button type="button" className="btn" title="Restart preview" onClick={onRetry}>
              <Icon name="refresh" size={14} />
              Try again
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={previewUrl === null}
              title="Reload preview"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <Icon name="refresh" size={14} />
              Reload
            </button>
          )}
        </div>
      </header>
      {previewUrl === null ? (
        <iframe className="preview__frame" title="Live preview" sandbox="" srcDoc={doc} />
      ) : (
        <iframe
          // Remounting forces a hard reload; the auto-reload connection
          // (WebSocket shim from packages/preview) keeps running independently.
          key={reloadNonce}
          className="preview__frame"
          title="Live preview"
          // allow-scripts: the AI page contains JS + the reload/error shim.
          // allow-same-origin: the loopback origin is token-protected; without it
          // the page's subresources/storage don't work reliably.
          sandbox="allow-scripts allow-same-origin"
          src={previewUrl}
        />
      )}
    </section>
  );
}
