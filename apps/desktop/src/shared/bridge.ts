/**
 * Desktop extension of the preload bridge (`window.wab`).
 *
 * The frozen base contract `WabBridge` (ping, projects, templates) lives in
 * @webaibuilder/core and must not be changed. This file adds the M2 surface
 * (session, chat, checkpoints, settings, event subscriptions) as its own,
 * additive contract. Preload exposes `WabBridge & WabDesktopBridge` under
 * `window.wab` (see preload/index.ts, env.d.ts).
 *
 * Since `BRIDGE_VERSION` is frozen in core, apps/desktop versions its additive
 * surface with its own constant.
 *
 * Environment-neutral (no node/electron/DOM).
 */

import type { BackendId, Checkpoint, PermissionDecision } from '@webaibuilder/core';

import type { BackendPickerState } from './backends';
import type {
  AgentEventMessage,
  ChatSendResult,
  CheckpointsMessage,
  DeployProgressMessage,
  DeployTargetsMessage,
  LogLocation,
  LogTailResult,
  OpenFolderResult,
  OpenHintResult,
  PreviewEventMessage,
  SessionInfo,
  UpdateStatus,
} from './channels';
import type {
  DeployHistoryRecord,
  DeployRunOutcome,
  DeployTargetInput,
  DeployTargetView,
  WabDriftResult,
  WabPreflightResult,
} from './deploy';
import type { RendererErrorReport } from './logging';
import type { OnboardingState, OnboardingStateInput } from './onboarding';
import type { AgentSettings, AgentSettingsInput } from './settings';

/**
 * Version of the additive desktop bridge surface.
 * v2 (M3): `settings.get`/`set` additionally return `keychainAvailable`; API keys
 *          live in the OS keychain instead of only in the main-process memory.
 * v3 (M3): deploy surface — target CRUD (password → keychain), connection test,
 *          publish/rollback with progress push, drift detection, deploy history.
 * v4 (M4): backend detection (all six backends) + kill-switch merge, "re-check",
 *          one-time acknowledgment of the Claude subscription notice, opening
 *          official onboarding links (allowlisted, external).
 * v5 (M5): auto-update — `update.onStatus` push (electron-updater status) +
 *          `update.restart` ("restart now", applies the downloaded update).
 * v6 (M5): first-launch onboarding (`onboarding.get`/`set`, `hasOnboarded`) +
 *          local error reports/logs (`logs.info`/`report`/`tail`/`openFolder`).
 */
export const WAB_DESKTOP_BRIDGE_VERSION = 6;

/** Unsubscribes a push subscription. */
export type Unsubscribe = () => void;

export interface WabDesktopBridge {
  readonly desktopVersion: typeof WAB_DESKTOP_BRIDGE_VERSION;

  session: {
    /** Opens a project: workspace init + preview start; returns URL + checkpoints. */
    open(projectId: string): Promise<SessionInfo>;
    /** Closes the active project (stop the preview, abort the turn). */
    close(): Promise<void>;
  };

  chat: {
    /** Starts a turn with a pre-generated run ID; events arrive via `onAgentEvent`. */
    send(prompt: string, runId: string): Promise<ChatSendResult>;
    /** Aborts the running turn (stop). */
    interrupt(): Promise<void>;
    /** Answers a permission request. */
    respondPermission(decision: PermissionDecision): Promise<void>;
  };

  checkpoints: {
    list(): Promise<Checkpoint[]>;
    /** Restores a checkpoint as a new commit. */
    restore(checkpointId: string): Promise<Checkpoint>;
  };

  settings: {
    get(): Promise<AgentSettings>;
    set(input: AgentSettingsInput): Promise<AgentSettings>;
  };

  backends: {
    /** Current state of all six backends (detection + kill-switch merge). */
    list(): Promise<BackendPickerState>;
    /** Forces a fresh detection ("re-check"). */
    refresh(): Promise<BackendPickerState>;
    /** Acknowledges a backend notice once (Claude subscription). */
    acknowledge(backendId: BackendId): Promise<BackendPickerState>;
    /** Opens an official onboarding link in the external browser (allowlisted). */
    openHint(url: string): Promise<OpenHintResult>;
  };

  deploy: {
    /** A project's deploy targets (incl. hasCredentials). */
    listTargets(projectId: string): Promise<DeployTargetView[]>;
    /** Create/update a target; password/passphrase go into the keychain. */
    saveTarget(projectId: string, input: DeployTargetInput): Promise<DeployTargetView>;
    /** Delete a target (also removes the keychain secret). */
    deleteTarget(projectId: string, targetId: string): Promise<void>;
    /** Connection test (preflight only) — structured findings. */
    test(projectId: string, targetId: string): Promise<WabPreflightResult>;
    /** Publish the current state; progress arrives via `onDeployProgress`. */
    run(projectId: string, targetId: string, runId: string): Promise<DeployRunOutcome>;
    /** Deploy an older version (rollback deploy). */
    rollback(
      projectId: string,
      targetId: string,
      toCommitSha: string,
      runId: string,
    ): Promise<DeployRunOutcome>;
    /** Drift detection: does the remote state differ from the expected SHA? */
    drift(projectId: string, targetId: string): Promise<WabDriftResult>;
    /** The project's deploy history (newest first). */
    history(projectId: string): Promise<DeployHistoryRecord[]>;
  };

  update: {
    /** Subscribes to the auto-update status (checking/available/downloading/ready/error). */
    onStatus(listener: (status: UpdateStatus) => void): Unsubscribe;
    /** Applies a downloaded update and restarts (quitAndInstall). */
    restart(): Promise<void>;
  };

  onboarding: {
    /** Current onboarding state (`hasOnboarded`). */
    get(): Promise<OnboardingState>;
    /** Sets the state (complete the flow or "show again"). */
    set(input: OnboardingStateInput): Promise<OnboardingState>;
  };

  logs: {
    /** Location of the local log files (folder + active file). */
    info(): Promise<LogLocation>;
    /** Reports a renderer JS error into the local log (no remote). */
    report(report: RendererErrorReport): Promise<void>;
    /** The last `lines` log lines as text ("Copy logs"). */
    tail(lines: number): Promise<LogTailResult>;
    /** Opens the local log folder in the file manager. */
    openFolder(): Promise<OpenFolderResult>;
  };

  events: {
    onAgentEvent(listener: (message: AgentEventMessage) => void): Unsubscribe;
    onPreviewEvent(listener: (message: PreviewEventMessage) => void): Unsubscribe;
    onCheckpoints(listener: (message: CheckpointsMessage) => void): Unsubscribe;
    onDeployProgress(listener: (message: DeployProgressMessage) => void): Unsubscribe;
    onDeployTargets(listener: (message: DeployTargetsMessage) => void): Unsubscribe;
  };
}
