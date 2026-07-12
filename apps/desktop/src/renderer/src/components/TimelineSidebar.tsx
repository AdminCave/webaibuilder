import type { Checkpoint } from '@webaibuilder/core';

/**
 * Timeline: Checkpoint-Liste mit Deployed-Badge (PLAN §5).
 * M0 zeigt den Leerzustand; Daten kommen ab M1 aus packages/versioning.
 */
export function TimelineSidebar(): React.JSX.Element {
  const checkpoints: Checkpoint[] = [];

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
              <p className="checkpoint__message">{cp.message}</p>
              <p className="checkpoint__meta">
                <span>{cp.createdAt}</span>
                {cp.deployed === true && <span className="badge badge--deployed">Deployed</span>}
              </p>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
