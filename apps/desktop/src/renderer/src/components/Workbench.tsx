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
  /** Opens settings at a specific location (chat empty state). */
  onOpenSettings: (route: SettingsRoute) => void;
  /** Reports freshly saved settings to the app (unlocks the chat). */
  onSettingsSaved: (settings: AgentSettings) => void;
}

/**
 * Workspace of an open project: wires the session (preview + chat + checkpoints)
 * and renders the three panels. The useProjectSession hook deliberately lives
 * here (not in App) so that it is always called.
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

  // Sum of the reported turn costs for the status bar.
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

  // Deploy status for the status bar (active target + last deployed SHA).
  const deployStatus = deployStatusLabel(deploy);
  useEffect(() => {
    onDeployStatusChange(deployStatus);
  }, [deployStatus, onDeployStatusChange]);
  useEffect(() => () => onDeployStatusChange(null), [onDeployStatusChange]);

  // Chat unlock from the one shared, tested source (shared/backends.ts
  // chatBlockReason): the main process validated subscription backends at
  // activation; API-key backends need a key (keychain or environment variable —
  // both covered by `hasApiKey`).
  const backendReady = chatBlockReason(settings) === null;

  // "Deployed" badge: mark the checkpoint whose SHA matches the active target's
  // last_deployed state (resolves the M1 placeholder).
  const checkpoints = markDeployedCheckpoints(session.checkpoints, deploy.deployedSha);
  const canDeployVersion = deploy.selectedTarget?.hasCredentials === true && !deploy.deploying;

  return (
    <>
      {/* Boundary per panel: a single panel crash doesn't take the app down;
          key={project.id} resets the error state when switching projects. */}
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
      <ErrorBoundary label="Preview" key={`preview:${project.id}`}>
        <PreviewPanel
          theme={theme}
          previewUrl={session.preview?.url ?? null}
          port={session.preview?.port ?? null}
          status={session.status}
          openError={session.openError}
          onRetry={session.retry}
        />
      </ErrorBoundary>
      <ErrorBoundary label="History" key={`timeline:${project.id}`}>
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

/** Short label for the status bar's deploy field. */
function deployStatusLabel(deploy: ReturnType<typeof useDeploy>): string | null {
  const target = deploy.selectedTarget;
  if (target === null) return null;
  if (deploy.deploying) return `${target.name} · publishing …`;
  const sha = target.lastDeployedCommit;
  return sha !== undefined ? `${target.name} · ${sha.slice(0, 7)}` : `${target.name} · never deployed`;
}
