import { useEffect, useState } from 'react';

import type { UpdateStatus } from '../../../shared/channels';

/**
 * Auto-Update-Hinweis (M5): erscheint erst, wenn ein Update fertig geladen ist
 * („ready"), und bietet genau eine betonte Aktion — jetzt neu starten. Der
 * Status kommt als Push über die Preload-Bridge (`window.wab.update.onStatus`);
 * das Anwenden läuft über den sender-validierten `update.restart`-Kanal.
 *
 * Bewusst minimal und unaufdringlich (AdminCave-DS): Hairline-Card unten rechts,
 * eine Pill-Aktion, keine Emojis. Fortschritt/Prüfung werden nicht angezeigt.
 */
export function UpdateNotice(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' });
  const [restarting, setRestarting] = useState(false);

  useEffect(() => window.wab.update.onStatus(setStatus), []);

  if (status.phase !== 'ready') return null;

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice__body">
        <span className="update-notice__title">Update bereit</span>
        <span className="update-notice__text">
          Version {status.version} ist geladen und wird beim nächsten Start aktiv.
        </span>
      </div>
      <button
        type="button"
        className="btn btn--primary update-notice__action"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          window.wab.update.restart().catch(() => setRestarting(false));
        }}
      >
        {restarting ? 'Wird neu gestartet …' : 'Jetzt neu starten'}
      </button>
    </div>
  );
}
