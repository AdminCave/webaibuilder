import { useEffect } from 'react';

import type { Project } from '@webaibuilder/core';

import type { AgentSettings } from '../../../shared/settings';
import type { Theme } from '../App';
import { useProjectSession } from '../hooks/useProjectSession';
import { ChatPanel } from './ChatPanel';
import { PreviewPanel } from './PreviewPanel';
import { TimelineSidebar } from './TimelineSidebar';

interface WorkbenchProps {
  project: Project;
  theme: Theme;
  settings: AgentSettings | null;
  onCostChange: (costUsd: number | null) => void;
}

/**
 * Arbeitsbereich eines geöffneten Projekts: verdrahtet die Sitzung (Preview +
 * Chat + Checkpoints) und rendert die drei Panels. Der useProjectSession-Hook
 * liegt bewusst hier (nicht in App), damit er unbedingt aufgerufen wird.
 */
export function Workbench({
  project,
  theme,
  settings,
  onCostChange,
}: WorkbenchProps): React.JSX.Element {
  const session = useProjectSession(project);

  // Summe der gemeldeten Turn-Kosten für die Statusleiste.
  const totalCost = session.chat.messages.reduce(
    (sum, message) =>
      message.role === 'assistant' && typeof message.costUsd === 'number'
        ? sum + message.costUsd
        : sum,
    0,
  );
  const hasCost = session.chat.messages.some(
    (m) => m.role === 'assistant' && typeof m.costUsd === 'number',
  );

  useEffect(() => {
    onCostChange(hasCost ? totalCost : null);
  }, [hasCost, totalCost, onCostChange]);

  useEffect(() => () => onCostChange(null), [onCostChange]);

  // Beide M2-Backends (byok, claude-sdk) brauchen einen API-Key.
  const backendReady = settings !== null && settings.hasApiKey;

  return (
    <>
      <ChatPanel
        chat={session.chat}
        backendReady={backendReady}
        backendId={settings?.backendId ?? null}
        onSend={session.send}
        onInterrupt={session.interrupt}
        onPermission={session.respondPermission}
        pageError={session.pageError}
        onFixError={session.fixPageError}
        onDismissError={session.dismissPageError}
      />
      <PreviewPanel
        theme={theme}
        previewUrl={session.preview?.url ?? null}
        port={session.preview?.port ?? null}
        status={session.status}
        openError={session.openError}
      />
      <TimelineSidebar
        checkpoints={session.checkpoints}
        restoringId={session.restoringId}
        onRestore={session.restore}
      />
    </>
  );
}
