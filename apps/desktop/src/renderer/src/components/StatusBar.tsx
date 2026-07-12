import type { PingResult } from '@webaibuilder/core';

import { activeBackendStatusLabel } from '../../../shared/backends';
import type { AgentSettings } from '../../../shared/settings';

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
  const costLabel = costUsd === null ? '—' : `${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)} $`;

  return (
    <footer className="statusbar">
      <span className="statusbar__item">Backend: {backendLabel}</span>
      <span className="statusbar__item">Kosten: {costLabel}</span>
      <span className="statusbar__item">Deploy: {deployStatus ?? '—'}</span>
      <span className="statusbar__spacer" />
      <span className="statusbar__item">
        {ping === null
          ? 'Bridge: nicht verbunden'
          : `Electron ${ping.versions.electron} · Chrome ${ping.versions.chrome} · Node ${ping.versions.node}`}
      </span>
    </footer>
  );
}
