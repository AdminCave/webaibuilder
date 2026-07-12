import type { PingResult } from '@webaibuilder/core';

import type { ActiveBackendId, AgentSettings } from '../../../shared/settings';

interface StatusBarProps {
  ping: PingResult | null;
  settings: AgentSettings | null;
  costUsd: number | null;
  /** Deploy-Kurzstatus (aktives Ziel + zuletzt deployte SHA) oder null. */
  deployStatus: string | null;
}

const BACKEND_LABEL: Record<ActiveBackendId, string> = {
  byok: 'Eigener API-Key',
  'claude-sdk': 'Claude (API)',
};

export function StatusBar({
  ping,
  settings,
  costUsd,
  deployStatus,
}: StatusBarProps): React.JSX.Element {
  const backendLabel =
    settings === null
      ? '—'
      : `${BACKEND_LABEL[settings.backendId]}${settings.hasApiKey ? '' : ' (kein Key)'}`;
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
