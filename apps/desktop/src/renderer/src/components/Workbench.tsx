import { useEffect, useState } from 'react';

import type { Project } from '@webaibuilder/core';

import { isSubscriptionBackend } from '../../../shared/backends';
import { markDeployedCheckpoints } from '../../../shared/deploy';
import type { AgentSettings } from '../../../shared/settings';
import type { Theme } from '../App';
import { useDeploy } from '../hooks/useDeploy';
import { useProjectSession } from '../hooks/useProjectSession';
import { ChatPanel } from './ChatPanel';
import { DeployDialog } from './DeployDialog';
import { PreviewPanel } from './PreviewPanel';
import { TimelineSidebar } from './TimelineSidebar';

interface WorkbenchProps {
  project: Project;
  theme: Theme;
  settings: AgentSettings | null;
  onCostChange: (costUsd: number | null) => void;
  onDeployStatusChange: (status: string | null) => void;
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
  onDeployStatusChange,
}: WorkbenchProps): React.JSX.Element {
  const session = useProjectSession(project);
  const deploy = useDeploy(project.id);
  const [showDeploy, setShowDeploy] = useState(false);

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

  // Deploy-Status für die Statusleiste (aktives Ziel + zuletzt deployte SHA).
  const deployStatus = deployStatusLabel(deploy);
  useEffect(() => {
    onDeployStatusChange(deployStatus);
  }, [deployStatus, onDeployStatusChange]);
  useEffect(() => () => onDeployStatusChange(null), [onDeployStatusChange]);

  // API-Key-Backends (byok, claude-sdk) brauchen einen hinterlegten Key. Abo-/
  // CLI-Backends brauchen keinen — der Main-Prozess hat ihre Nutzbarkeit bei der
  // Auswahl bereits geprüft (installiert/eingeloggt/Kill-Switch/Hinweis, PLAN §3).
  const backendReady =
    settings !== null && (isSubscriptionBackend(settings.backendId) || settings.hasApiKey);

  // „Deployed"-Badge: den Checkpoint markieren, dessen SHA dem last_deployed-
  // Stand des aktiven Ziels entspricht (löst den M1-Platzhalter auf).
  const checkpoints = markDeployedCheckpoints(session.checkpoints, deploy.deployedSha);
  const canDeployVersion = deploy.selectedTarget?.hasCredentials === true && !deploy.deploying;

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
        checkpoints={checkpoints}
        restoringId={session.restoringId}
        onRestore={session.restore}
        onOpenDeploy={() => setShowDeploy(true)}
        driftWarning={deploy.drift?.drift === true}
        canDeployVersion={canDeployVersion}
        deployingSha={deploy.rollbackSha}
        onDeployVersion={(sha) => {
          setShowDeploy(true);
          void deploy.rollbackTo(sha);
        }}
      />
      {showDeploy && (
        <DeployDialog
          deploy={deploy}
          keychainAvailable={settings?.keychainAvailable ?? true}
          onClose={() => setShowDeploy(false)}
        />
      )}
    </>
  );
}

/** Kurzlabel fürs Deploy-Feld der Statusleiste. */
function deployStatusLabel(deploy: ReturnType<typeof useDeploy>): string | null {
  const target = deploy.selectedTarget;
  if (target === null) return null;
  if (deploy.deploying) return `${target.name} · veröffentliche …`;
  const sha = target.lastDeployedCommit;
  return sha !== undefined ? `${target.name} · ${sha.slice(0, 7)}` : `${target.name} · nie deployt`;
}
