import type { PingResult } from '@webaibuilder/core';

import { activeBackendStatusLabel } from '../../../shared/backends';
import type { AgentSettings } from '../../../shared/settings';
import { Icon } from './Icon';

interface StatusBarProps {
  ping: PingResult | null;
  settings: AgentSettings | null;
  costUsd: number | null;
  /** Deploy-Kurzstatus (aktives Ziel + zuletzt deployte SHA) oder null. */
  deployStatus: string | null;
}

export function StatusBar({
  ping,
  settings,
  costUsd,
  deployStatus,
}: StatusBarProps): React.JSX.Element {
  const backendLabel =
    settings === null ? '—' : activeBackendStatusLabel(settings.backendId, settings.hasApiKey);

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        <Icon name="cpu" size={12} />
        Backend: {backendLabel}
      </span>
      {/* Viele Abo-CLIs melden keine Kosten — statt dauerhaft „Kosten: —" den
          Chip nur zeigen, wenn mindestens ein Turn echte Kosten geliefert hat. */}
      {costUsd !== null && (
        <span className="statusbar__item">
          Kosten: {`${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)} $`}
        </span>
      )}
      <span className="statusbar__item">
        <Icon name="deploy" size={12} />
        Deploy: {deployStatus ?? '—'}
      </span>
      <span className="statusbar__spacer" />
      <span className="statusbar__item">
        <Icon
          name="plug"
          size={12}
          className={ping === null ? 'status-icon status-icon--warn' : 'status-icon status-icon--ok'}
        />
        {ping === null
          ? 'Bridge: nicht verbunden'
          : `Electron ${ping.versions.electron} · Chrome ${ping.versions.chrome} · Node ${ping.versions.node}`}
      </span>
    </footer>
  );
}
