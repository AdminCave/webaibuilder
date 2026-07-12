import type { PingResult } from '@webaibuilder/core';

interface StatusBarProps {
  ping: PingResult | null;
}

export function StatusBar({ ping }: StatusBarProps): React.JSX.Element {
  return (
    <footer className="statusbar">
      <span className="statusbar__item">Backend: —</span>
      <span className="statusbar__item">Kosten: —</span>
      <span className="statusbar__item">Deploy: —</span>
      <span className="statusbar__spacer" />
      <span className="statusbar__item">
        {ping === null
          ? 'Bridge: nicht verbunden'
          : `Electron ${ping.versions.electron} · Chrome ${ping.versions.chrome} · Node ${ping.versions.node}`}
      </span>
    </footer>
  );
}
