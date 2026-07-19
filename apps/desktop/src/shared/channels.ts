/**
 * Desktop-local IPC channel registry for the M2 features (chat, preview,
 * checkpoints, settings).
 *
 * The base channels (ping, projects, templates) live in @webaibuilder/core
 * (frozen). Since core must not be extended, apps/desktop defines its additional
 * channels here — following the same convention
 * `wab:v<version>:<domain>:<action>` and likewise fully typed.
 *
 * Environment-neutral (no node/electron/DOM); shared by main, preload, and
 * renderer.
 */

import type { AgentEvent, BackendId, Checkpoint, PermissionDecision } from '@webaibuilder/core';

import type { BackendPickerState } from './backends';
import type {
  DeployHistoryRecord,
  DeployRunOutcome,
  DeployTargetInput,
  DeployTargetView,
  WabDeployProgressEvent,
  WabDriftResult,
  WabPreflightResult,
} from './deploy';
import type { RendererErrorReport } from './logging';
import type { OnboardingState, OnboardingStateInput } from './onboarding';
import type { WabPreviewEvent } from './preview';
import type { AgentSettings, AgentSettingsInput } from './settings';

/* ---------------- Request/response channels (renderer → main) ---------------- */

export const DesktopIpcChannels = {
  /** Open a project: initialize the workspace + start the preview. */
  sessionOpen: 'wab:v1:session:open',
  /** Close the active project: stop the preview, abort the turn. */
  sessionClose: 'wab:v1:session:close',
  /** Send a chat message: start a turn (events arrive as push). */
  chatSend: 'wab:v1:chat:send',
  /** Abort the running turn (stop action). */
  chatInterrupt: 'wab:v1:chat:interrupt',
  /** Answer to a permission request (allow/deny). */
  chatPermission: 'wab:v1:chat:permission',
  /** List the checkpoints of the active project. */
  checkpointsList: 'wab:v1:checkpoints:list',
  /** Restore a checkpoint (as a new commit). */
  checkpointsRestore: 'wab:v1:checkpoints:restore',
  /** Read the current backend settings (without the key). */
  settingsGet: 'wab:v1:settings:get',
  /** Set the backend settings (key only renderer → main). */
  settingsSet: 'wab:v1:settings:set',
  /** List a project's deploy targets (incl. hasCredentials). */
  deployTargetsList: 'wab:v1:deploytargets:list',
  /** Create/update a deploy target (password → keychain). */
  deployTargetsSave: 'wab:v1:deploytargets:save',
  /** Delete a deploy target (also removes the keychain secret). */
  deployTargetsDelete: 'wab:v1:deploytargets:delete',
  /** Connection test (preflight only), returns structured findings. */
  deployTest: 'wab:v1:deploy:test',
  /** Publish the current state (preflight + deploy, progress as push). */
  deployRun: 'wab:v1:deploy:run',
  /** Deploy an older version (rollback deploy, progress as push). */
  deployRollback: 'wab:v1:deploy:rollback',
  /** Drift detection: remote state vs. expected SHA. */
  deployDrift: 'wab:v1:deploy:drift',
  /** List a project's deploy history. */
  deployHistory: 'wab:v1:deploy:history',
  /** Detect AI backends + kill-switch merge (from the cache, M4). */
  backendsList: 'wab:v1:backends:list',
  /** Re-check backends (forces a fresh detection, M4). */
  backendsRefresh: 'wab:v1:backends:refresh',
  /** Acknowledge a backend notice once (Claude subscription, M4). */
  backendsAck: 'wab:v1:backends:ack',
  /** Open an official onboarding link in the external browser (allowlisted, M4). */
  backendsOpenHint: 'wab:v1:backends:openhint',
  /** "Restart now": apply the downloaded update (quitAndInstall, M5). */
  updateRestart: 'wab:v1:update:restart',
  /** Read the onboarding state (`hasOnboarded`, M5). */
  onboardingGet: 'wab:v1:onboarding:get',
  /** Set the onboarding state (complete / show again, M5). */
  onboardingSet: 'wab:v1:onboarding:set',
  /** Log location (folder + file) for the "Errors & Logs" view (M5). */
  logsInfo: 'wab:v1:logs:info',
  /** Renderer reports a JS error into the local log (M5). */
  logsReport: 'wab:v1:logs:report',
  /** Fetch the last N log lines ("Copy logs", M5). */
  logsTail: 'wab:v1:logs:tail',
  /** Open the local log folder in the file manager (M5). */
  logsOpen: 'wab:v1:logs:open',
} as const;

export type DesktopIpcChannel = (typeof DesktopIpcChannels)[keyof typeof DesktopIpcChannels];

/* ---------------- Event channels (main → renderer, push) ---------------- */

export const DesktopIpcEvents = {
  /** An `AgentEvent` of a running turn. */
  agent: 'wab:v1:event:agent',
  /** A `WabPreviewEvent` (reload / page-console / page-error). */
  preview: 'wab:v1:event:preview',
  /** Fresh checkpoint list (after turn completion / restore). */
  checkpoints: 'wab:v1:event:checkpoints',
  /** A `WabDeployProgressEvent` of a running deploy/rollback. */
  deploy: 'wab:v1:event:deploy',
  /** Fresh deploy-target list (after deploy/rollback → new last_deployed SHA). */
  targets: 'wab:v1:event:targets',
  /** Auto-update status (electron-updater, M5) — app-global, project-independent. */
  update: 'wab:v1:event:update',
} as const;

export type DesktopIpcEvent = (typeof DesktopIpcEvents)[keyof typeof DesktopIpcEvents];

/* ---------------- Payload types ---------------- */

export interface PreviewInfo {
  /** Full iframe URL incl. token: `http://127.0.0.1:<port>/?wab=<token>`. */
  url: string;
  port: number;
  /** Origin without the token — for postMessage/error-path matching in the renderer. */
  origin: string;
}

export interface SessionInfo {
  projectId: string;
  preview: PreviewInfo;
  checkpoints: Checkpoint[];
}

export interface ChatSendInput {
  prompt: string;
  /**
   * Run ID generated by the renderer. It is set before sending so that the
   * assistant message exists before the first push events arrive (no loss of
   * early text-delta events through a race condition).
   */
  runId: string;
}

export interface ChatSendResult {
  /** Confirmed run ID (echo). */
  runId: string;
}

/** Push payload of an agent event. */
export interface AgentEventMessage {
  runId: string;
  projectId: string;
  event: AgentEvent;
}

/** Push payload of a preview event. */
export interface PreviewEventMessage {
  projectId: string;
  event: WabPreviewEvent;
}

/** Push payload of the updated checkpoint list. */
export interface CheckpointsMessage {
  projectId: string;
  checkpoints: Checkpoint[];
}

/** Push payload of a deploy progress event (file-by-file). */
export interface DeployProgressMessage {
  projectId: string;
  targetId: string;
  /** Run ID generated by the renderer (correlates progress with the call). */
  runId: string;
  event: WabDeployProgressEvent;
}

/** Push payload of the updated deploy-target list (fresh last_deployed SHA). */
export interface DeployTargetsMessage {
  projectId: string;
  targets: DeployTargetView[];
}

/** Result of {@link DesktopIpcChannels.backendsOpenHint}. */
export interface OpenHintResult {
  /** true = the link was allowed and handed to the external browser. */
  opened: boolean;
}

/** Location of the local log files (M5, "Errors & Logs"). */
export interface LogLocation {
  /** Directory of the log files (`<userData>/logs`). */
  dir: string;
  /** Path of the active log file (`<userData>/logs/app.log`). */
  file: string;
}

/** Result of the "Copy logs" action: the last N lines as text. */
export interface LogTailResult {
  text: string;
}

/** Result of opening the log folder (M5). */
export interface OpenFolderResult {
  /** true = the folder was handed to the file manager. */
  opened: boolean;
}

/**
 * Auto-update status (M5, electron-updater). Pushed to the renderer via
 * {@link DesktopIpcEvents.update}. A discriminated union so the UI only shows the
 * `ready` state as a call to action.
 */
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'not-available' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

/* ---------------- Per-channel contracts ---------------- */

export interface DesktopIpcInvokeMap {
  [DesktopIpcChannels.sessionOpen]: { args: [projectId: string]; result: SessionInfo };
  [DesktopIpcChannels.sessionClose]: { args: []; result: void };
  [DesktopIpcChannels.chatSend]: { args: [input: ChatSendInput]; result: ChatSendResult };
  [DesktopIpcChannels.chatInterrupt]: { args: []; result: void };
  [DesktopIpcChannels.chatPermission]: { args: [decision: PermissionDecision]; result: void };
  [DesktopIpcChannels.checkpointsList]: { args: []; result: Checkpoint[] };
  [DesktopIpcChannels.checkpointsRestore]: {
    args: [checkpointId: string];
    result: Checkpoint;
  };
  [DesktopIpcChannels.settingsGet]: { args: []; result: AgentSettings };
  [DesktopIpcChannels.settingsSet]: { args: [input: AgentSettingsInput]; result: AgentSettings };
  [DesktopIpcChannels.deployTargetsList]: {
    args: [projectId: string];
    result: DeployTargetView[];
  };
  [DesktopIpcChannels.deployTargetsSave]: {
    args: [projectId: string, input: DeployTargetInput];
    result: DeployTargetView;
  };
  [DesktopIpcChannels.deployTargetsDelete]: {
    args: [projectId: string, targetId: string];
    result: void;
  };
  [DesktopIpcChannels.deployTest]: {
    args: [projectId: string, targetId: string];
    result: WabPreflightResult;
  };
  [DesktopIpcChannels.deployRun]: {
    args: [projectId: string, targetId: string, runId: string];
    result: DeployRunOutcome;
  };
  [DesktopIpcChannels.deployRollback]: {
    args: [projectId: string, targetId: string, toCommitSha: string, runId: string];
    result: DeployRunOutcome;
  };
  [DesktopIpcChannels.deployDrift]: {
    args: [projectId: string, targetId: string];
    result: WabDriftResult;
  };
  [DesktopIpcChannels.deployHistory]: {
    args: [projectId: string];
    result: DeployHistoryRecord[];
  };
  [DesktopIpcChannels.backendsList]: { args: []; result: BackendPickerState };
  [DesktopIpcChannels.backendsRefresh]: { args: []; result: BackendPickerState };
  [DesktopIpcChannels.backendsAck]: { args: [backendId: BackendId]; result: BackendPickerState };
  [DesktopIpcChannels.backendsOpenHint]: { args: [url: string]; result: OpenHintResult };
  [DesktopIpcChannels.updateRestart]: { args: []; result: void };
  [DesktopIpcChannels.onboardingGet]: { args: []; result: OnboardingState };
  [DesktopIpcChannels.onboardingSet]: {
    args: [input: OnboardingStateInput];
    result: OnboardingState;
  };
  [DesktopIpcChannels.logsInfo]: { args: []; result: LogLocation };
  [DesktopIpcChannels.logsReport]: { args: [report: RendererErrorReport]; result: void };
  [DesktopIpcChannels.logsTail]: { args: [lines: number]; result: LogTailResult };
  [DesktopIpcChannels.logsOpen]: { args: []; result: OpenFolderResult };
}

export type DesktopIpcArgs<C extends DesktopIpcChannel> = DesktopIpcInvokeMap[C]['args'];
export type DesktopIpcResult<C extends DesktopIpcChannel> = DesktopIpcInvokeMap[C]['result'];

/** Payload type per push-event channel. */
export interface DesktopIpcEventMap {
  [DesktopIpcEvents.agent]: AgentEventMessage;
  [DesktopIpcEvents.preview]: PreviewEventMessage;
  [DesktopIpcEvents.checkpoints]: CheckpointsMessage;
  [DesktopIpcEvents.deploy]: DeployProgressMessage;
  [DesktopIpcEvents.targets]: DeployTargetsMessage;
  [DesktopIpcEvents.update]: UpdateStatus;
}

export type DesktopIpcEventPayload<C extends DesktopIpcEvent> = DesktopIpcEventMap[C];
