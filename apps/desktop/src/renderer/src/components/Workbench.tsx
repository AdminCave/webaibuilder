import { useEffect, useState } from 'react';

import type { Project } from '@webaibuilder/core';

import { chatBlockReason } from '../../../shared/backends';
import { markDeployedCheckpoints } from '../../../shared/deploy';
import type { AgentSettings } from '../../../shared/settings';
import type { SettingsRoute } from '../../../shared/settingsNav';
import type { Theme } from '../App';
import { useDeploy } from '../hooks/useDeploy';
import { useProjectSession } from '../hooks/useProjectSession';
import { ChatPanel } from './ChatPanel';
import { DeployDialog } from './DeployDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { PreviewPanel } from './PreviewPanel';
import { TimelineSidebar } from './TimelineSidebar';

interface WorkbenchProps {
  project: Project;
  theme: Theme;
  settings: AgentSettings | null;
  onCostChange: (costUsd: number | null) => void;
  onDeployStatusChange: (status: string | null) => void;
  /** Öffnet die Einstellungen an einer bestimmten Stelle (Chat-Empty-State). */
  onOpenSettings: (route: SettingsRoute) => void;
  /** Frisch gespeicherte Einstellungen an die App melden (Chat-Freischaltung). */
  onSettingsSaved: (settings: AgentSettings) => void;
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
  onOpenSettings,
  onSettingsSaved,
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

  // Chat-Freischaltung aus der einen geteilten, getesteten Quelle
  // (shared/backends.ts chatBlockReason): Abo-Backends hat der Main-Prozess bei
  // der Aktivierung geprüft; API-Key-Backends brauchen einen Key (Schlüsselbund
  // oder Umgebungsvariable — beides in `hasApiKey` enthalten).
  const backendReady = chatBlockReason(settings) === null;

  // „Deployed"-Badge: den Checkpoint markieren, dessen SHA dem last_deployed-
  // Stand des aktiven Ziels entspricht (löst den M1-Platzhalter auf).
  const checkpoints = markDeployedCheckpoints(session.checkpoints, deploy.deployedSha);
  const canDeployVersion = deploy.selectedTarget?.hasCredentials === true && !deploy.deploying;

  return (
    <>
      {/* Boundary pro Panel: ein Panel-Crash reißt nicht die App mit;
          key={project.id} setzt den Fehlerzustand beim Projektwechsel zurück. */}
      <ErrorBoundary label="Chat" key={`chat:${project.id}`}>
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
          onOpenSettings={onOpenSettings}
          onSettingsSaved={onSettingsSaved}
        />
      </ErrorBoundary>
      <ErrorBoundary label="Vorschau" key={`preview:${project.id}`}>
        <PreviewPanel
          theme={theme}
          previewUrl={session.preview?.url ?? null}
          port={session.preview?.port ?? null}
          status={session.status}
          openError={session.openError}
          onRetry={session.retry}
        />
      </ErrorBoundary>
      <ErrorBoundary label="Verlauf" key={`timeline:${project.id}`}>
        <TimelineSidebar
          checkpoints={checkpoints}
          restoringId={session.restoringId}
          restoreError={session.restoreError}
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
      </ErrorBoundary>
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
