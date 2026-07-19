import type { Checkpoint } from '@webaibuilder/core';

import { Icon } from './Icon';

interface TimelineSidebarProps {
  /** Checkpoints already marked with the "Deployed" flag (see Workbench). */
  checkpoints: Checkpoint[];
  /** ID of the checkpoint currently being restored (or null). */
  restoringId: string | null;
  /** Error of the last restore (previously a silent failure). */
  restoreError: string | null;
  onRestore: (checkpointId: string) => void;
  /** Opens the deploy UI (targets, test, publish, history). */
  onOpenDeploy: () => void;
  /** Remote differs from the last deployed state (drift, PLAN §4). */
  driftWarning: boolean;
  /** "Deploy this version" (rollback deploy) to the active target. */
  onDeployVersion: (sha: string) => void;
  /** true when a target with credentials is active and no deploy is in flight. */
  canDeployVersion: boolean;
  /** SHA currently being published via rollback deploy (or null). */
  deployingSha: string | null;
}

/**
 * Timeline: checkpoint list (mono short SHA + message + relative time), restore,
 * "Deployed" badge, and "deploy this version" (M3, PLAN §5). The badge sits on
 * the checkpoint whose SHA matches the active target's last_deployed state
 * (resolved in Workbench).
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
    <aside className="timeline" aria-label="History">
      <header className="panel__header">
        <h1 className="panel__title">History</h1>
        <div className="panel__header-actions">
          <button type="button" className="btn checkpoint__restore" onClick={onOpenDeploy}>
            <Icon name="deploy" size={14} />
            Publish
          </button>
        </div>
      </header>
      <div className="timeline__list">
        {driftWarning && (
          <p className="timeline__drift" role="status">
            The server differs from the last deployed state.
          </p>
        )}
        {restoreError !== null && (
          <p className="timeline__error" role="alert">
            Restore failed: {restoreError}
          </p>
        )}
        {checkpoints.length === 0 ? (
          <div className="timeline__empty">
            <p className="timeline__empty-title">No checkpoints yet</p>
            <p>
              Every AI step automatically creates a restore point here. Deployed states get a badge.
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
                      ? 'Deploy this version to the active target'
                      : 'Create a deploy target with a password first'
                  }
                  hidden={!canDeployVersion && deployingSha !== cp.id}
                >
                  {deployingSha === cp.id ? 'Publishing …' : 'Deploy this version'}
                </button>
                <button
                  type="button"
                  className="btn checkpoint__restore"
                  disabled={busy}
                  onClick={() => onRestore(cp.id)}
                >
                  <Icon name="history" size={14} />
                  {restoringId === cp.id ? 'Restoring …' : 'Restore'}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

/** Rough relative time without an external dependency. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString('en-GB');
}
