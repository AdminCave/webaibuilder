import type { Checkpoint } from '@webaibuilder/core';

import { Icon } from './Icon';

interface TimelineSidebarProps {
  /** Bereits mit dem „Deployed"-Flag markierte Checkpoints (siehe Workbench). */
  checkpoints: Checkpoint[];
  /** ID des Checkpoints, der gerade wiederhergestellt wird (oder null). */
  restoringId: string | null;
  /** Fehler des letzten Wiederherstellens (vorher stiller Fehlschlag). */
  restoreError: string | null;
  onRestore: (checkpointId: string) => void;
  /** Öffnet die Deploy-Oberfläche (Ziele, Test, Veröffentlichen, Historie). */
  onOpenDeploy: () => void;
  /** Remote weicht vom zuletzt deployten Stand ab (Drift, PLAN §4). */
  driftWarning: boolean;
  /** „diese Version deployen" (Rollback-Deploy) auf das aktive Ziel. */
  onDeployVersion: (sha: string) => void;
  /** true, wenn ein Ziel mit Zugangsdaten aktiv und kein Deploy unterwegs ist. */
  canDeployVersion: boolean;
  /** SHA, die gerade per Rollback-Deploy veröffentlicht wird (oder null). */
  deployingSha: string | null;
}

/**
 * Timeline: Checkpoint-Liste (mono Kurz-SHA + Nachricht + relative Zeit),
 * Wiederherstellen, „Deployed"-Badge und „diese Version deployen" (M3, PLAN §5).
 * Das Badge sitzt auf dem Checkpoint, dessen SHA dem last_deployed-Stand des
 * aktiven Ziels entspricht (in Workbench aufgelöst).
 */
export function TimelineSidebar({
  checkpoints,
  restoringId,
  restoreError,
  onRestore,
  onOpenDeploy,
  driftWarning,
  onDeployVersion,
  canDeployVersion,
  deployingSha,
}: TimelineSidebarProps): React.JSX.Element {
  const busy = restoringId !== null || deployingSha !== null;

  return (
    <aside className="timeline" aria-label="Verlauf">
      <header className="panel__header">
        <h1 className="panel__title">Verlauf</h1>
        <div className="panel__header-actions">
          <button type="button" className="btn checkpoint__restore" onClick={onOpenDeploy}>
            <Icon name="deploy" size={14} />
            Veröffentlichen
          </button>
        </div>
      </header>
      <div className="timeline__list">
        {driftWarning && (
          <p className="timeline__drift" role="status">
            Der Server weicht vom zuletzt deployten Stand ab.
          </p>
        )}
        {restoreError !== null && (
          <p className="timeline__error" role="alert">
            Wiederherstellen fehlgeschlagen: {restoreError}
          </p>
        )}
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
                  onClick={() => onDeployVersion(cp.id)}
                  title={
                    canDeployVersion
                      ? 'Diese Version auf das aktive Ziel deployen'
                      : 'Erst ein Deploy-Ziel mit Passwort anlegen'
                  }
                  hidden={!canDeployVersion && deployingSha !== cp.id}
                >
                  {deployingSha === cp.id ? 'Wird veröffentlicht …' : 'Diese Version deployen'}
                </button>
                <button
                  type="button"
                  className="btn checkpoint__restore"
                  disabled={busy}
                  onClick={() => onRestore(cp.id)}
                >
                  <Icon name="history" size={14} />
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
