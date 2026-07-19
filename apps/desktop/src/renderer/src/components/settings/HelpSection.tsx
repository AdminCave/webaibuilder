/**
 * Sektion „Hilfe & Logs" (vorher HelpLogsSection im alten SettingsDialog):
 * Onboarding erneut zeigen + lokaler Log-Zugang (Pfad, Ordner öffnen, letzte
 * Zeilen kopieren). Alles rein lokal (PLAN §1) — es wird nichts gesendet.
 */

import { useEffect, useState } from 'react';

import { copyToClipboard } from '../../lib/clipboard';

/** Anzahl Log-Zeilen, die „Logs kopieren" in die Zwischenablage legt. */
const LOG_TAIL_LINES = 500;

export function HelpSection({
  onReplayOnboarding,
}: {
  onReplayOnboarding: () => void;
}): React.JSX.Element {
  const [logFile, setLogFile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.wab.logs
      .info()
      .then((info) => {
        if (!cancelled) setLogFile(info.file);
      })
      .catch(() => {
        if (!cancelled) setLogFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyLogs(): Promise<void> {
    setFeedback(null);
    try {
      const { text } = await window.wab.logs.tail(LOG_TAIL_LINES);
      if (text.trim() === '') {
        setFeedback('Es gibt noch keine Log-Einträge.');
        return;
      }
      const ok = await copyToClipboard(text);
      setFeedback(
        ok ? 'Die letzten Log-Zeilen liegen in der Zwischenablage.' : 'Kopieren fehlgeschlagen.',
      );
    } catch {
      setFeedback('Logs konnten nicht gelesen werden.');
    }
  }

  function openFolder(): void {
    setFeedback(null);
    window.wab.logs
      .openFolder()
      .then((result) => {
        // Vorher stiller Fehlschlag (z. B. kein Dateimanager) — jetzt Feedback.
        if (!result.opened) setFeedback('Der Ordner konnte nicht geöffnet werden.');
      })
      .catch(() => setFeedback('Der Ordner konnte nicht geöffnet werden.'));
  }

  return (
    <section className="help-logs" aria-label="Hilfe & Logs">
      <div className="help-logs__row">
        <div className="help-logs__text">
          <span className="help-logs__label">Einführung</span>
          <span className="field__hint">Zeigt den Willkommens-Flow erneut.</span>
        </div>
        <button type="button" className="btn help-logs__btn" onClick={onReplayOnboarding}>
          Einführung erneut zeigen
        </button>
      </div>

      <div className="help-logs__row">
        <div className="help-logs__text">
          <span className="help-logs__label">Fehler &amp; Logs</span>
          <span className="field__hint">
            Läuft etwas schief, landen die Details in einem lokalen Log auf deinem Rechner. Es wird
            nichts an einen Server gesendet.
          </span>
          {logFile !== null && <span className="help-logs__path">{logFile}</span>}
        </div>
        <div className="help-logs__actions">
          <button type="button" className="btn help-logs__btn" onClick={openFolder}>
            Ordner öffnen
          </button>
          <button type="button" className="btn help-logs__btn" onClick={() => void copyLogs()}>
            Logs kopieren
          </button>
        </div>
      </div>

      {feedback !== null && (
        <p className="help-logs__feedback" role="status">
          {feedback}
        </p>
      )}
    </section>
  );
}
