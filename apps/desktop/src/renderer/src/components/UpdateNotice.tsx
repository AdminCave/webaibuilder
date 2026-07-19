import { useEffect, useState } from 'react';

import type { UpdateStatus } from '../../../shared/channels';

/**
 * Auto-update notice (M5): appears only once an update has finished downloading
 * ("ready") and offers exactly one emphasized action — restart now. The status
 * arrives as a push over the preload bridge (`window.wab.update.onStatus`);
 * applying it runs through the sender-validated `update.restart` channel.
 *
 * Deliberately minimal and unobtrusive (AdminCave DS): hairline card bottom
 * right, one pill action, no emojis. Progress/checking are not shown.
 */
export function UpdateNotice(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' });
  const [restarting, setRestarting] = useState(false);

  useEffect(() => window.wab.update.onStatus(setStatus), []);

  if (status.phase !== 'ready') return null;

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice__body">
        <span className="update-notice__title">Update ready</span>
        <span className="update-notice__text">
          Version {status.version} is downloaded and becomes active on the next launch.
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
        {restarting ? 'Restarting …' : 'Restart now'}
      </button>
    </div>
  );
}
