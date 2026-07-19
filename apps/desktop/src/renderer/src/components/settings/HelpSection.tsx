/**
 * "Help & Logs" section (formerly HelpLogsSection in the old SettingsDialog):
 * replay onboarding + local log access (path, open folder, copy the last
 * lines). Entirely local (PLAN §1) — nothing is sent.
 */

import { useEffect, useState } from 'react';

import { copyToClipboard } from '../../lib/clipboard';

/** Number of log lines that "Copy logs" puts on the clipboard. */
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
        setFeedback('There are no log entries yet.');
        return;
      }
      const ok = await copyToClipboard(text);
      setFeedback(
        ok ? 'The last log lines are on the clipboard.' : 'Copy failed.',
      );
    } catch {
      setFeedback('Could not read logs.');
    }
  }

  function openFolder(): void {
    setFeedback(null);
    window.wab.logs
      .openFolder()
      .then((result) => {
        // Previously a silent failure (e.g. no file manager) — now feedback.
        if (!result.opened) setFeedback('Could not open the folder.');
      })
      .catch(() => setFeedback('Could not open the folder.'));
  }

  return (
    <section className="help-logs" aria-label="Help & Logs">
      <div className="help-logs__row">
        <div className="help-logs__text">
          <span className="help-logs__label">Intro</span>
          <span className="field__hint">Shows the welcome flow again.</span>
        </div>
        <button type="button" className="btn help-logs__btn" onClick={onReplayOnboarding}>
          Show the intro again
        </button>
      </div>

      <div className="help-logs__row">
        <div className="help-logs__text">
          <span className="help-logs__label">Errors &amp; Logs</span>
          <span className="field__hint">
            If something goes wrong, the details land in a local log on your machine. Nothing is sent
            to a server.
          </span>
          {logFile !== null && <span className="help-logs__path">{logFile}</span>}
        </div>
        <div className="help-logs__actions">
          <button type="button" className="btn help-logs__btn" onClick={openFolder}>
            Open folder
          </button>
          <button type="button" className="btn help-logs__btn" onClick={() => void copyLogs()}>
            Copy logs
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
