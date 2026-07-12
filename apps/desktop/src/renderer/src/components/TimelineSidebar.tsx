import type { Checkpoint } from '@webaibuilder/core';

interface TimelineSidebarProps {
  checkpoints: Checkpoint[];
  /** ID des Checkpoints, der gerade wiederhergestellt wird (oder null). */
  restoringId: string | null;
  onRestore: (checkpointId: string) => void;
}

/**
 * Timeline: Checkpoint-Liste (mono Kurz-SHA + Nachricht + relative Zeit),
 * Wiederherstellen-Button und Deployed-Badge (PLAN §5). Deploy folgt in M3 —
 * das Badge bleibt bis dahin nur bei bereits deployten SHAs sichtbar.
 */
export function TimelineSidebar({
  checkpoints,
  restoringId,
  onRestore,
}: TimelineSidebarProps): React.JSX.Element {
  const busy = restoringId !== null;

  return (
    <aside className="timeline" aria-label="Verlauf">
      <header className="panel__header">
        <h1 className="panel__title">Verlauf</h1>
      </header>
      <div className="timeline__list">
        {checkpoints.length === 0 ? (
          <div className="timeline__empty">
            <p className="timeline__empty-title">Noch keine Checkpoints</p>
            <p>
              Jeder KI-Schritt legt hier automatisch einen Wiederherstellungspunkt an. Deployte
              Stände bekommen ein Badge.
            </p>
          </div>
        ) : (
          checkpoints.map((cp) => (
            <article key={cp.id} className="checkpoint">
              <p className="checkpoint__message">{cp.versionName ?? cp.message}</p>
              <p className="checkpoint__meta">
                <span>{cp.id.slice(0, 7)}</span>
                <span>·</span>
                <span>{relativeTime(cp.createdAt)}</span>
                {cp.deployed === true && <span className="badge badge--deployed">Deployed</span>}
              </p>
              <div className="checkpoint__actions">
                <button
                  type="button"
                  className="btn checkpoint__restore"
                  disabled={busy}
                  onClick={() => onRestore(cp.id)}
                >
                  {restoringId === cp.id ? 'Wird wiederhergestellt …' : 'Wiederherstellen'}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

/** Grobe, deutschsprachige Relativzeit ohne externe Abhängigkeit. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 30) return `vor ${days} T.`;
  return new Date(then).toLocaleDateString('de-DE');
}
