/**
 * Backend detection, onboarding, and remote kill switch (PLAN §3/§4, M4) —
 * the pure, environment-neutral logic. Shared by main, preload, and renderer,
 * and headless-testable (no node/electron/DOM).
 *
 * Compliance (PLAN §3, non-negotiable):
 *  - Subscription backends run exclusively through the official vendor CLI that
 *    the user installed and signed into themselves. This app NEVER reads, stores,
 *    or transmits a subscription token. There is deliberately NO base-URL or
 *    token-override logic here.
 *  - Each subscription provider has a remote kill switch (Rule 3): a subscription
 *    path must be disableable overnight without a release. The kill switch is
 *    fail-safe (network error → last cache → bundled default).
 *  - The Claude subscription path (`claude-cli`) sits behind a feature flag with
 *    an in-app notice that the user must acknowledge once.
 *  - Branding: never "Claude Code" as a product name; "Claude (subscription)" and
 *    "works with Claude Agent" phrasings are fine.
 */

import type { BackendId } from '@webaibuilder/core';

/* ------------------------------------------------------------------ */
/* Grouping: subscription vs. API key                                  */
/* ------------------------------------------------------------------ */

export type BackendGroup = 'subscription' | 'apikey';

/** Subscription backends (the user's official vendor CLI, PLAN §3/§4). */
export const SUBSCRIPTION_BACKEND_IDS = ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'] as const;
/** API-key backends (foundation + fallback, PLAN §3 Rule 4). */
export const APIKEY_BACKEND_IDS = ['byok', 'claude-sdk'] as const;

export type SubscriptionBackendId = (typeof SUBSCRIPTION_BACKEND_IDS)[number];
export type ApiKeyBackendId = (typeof APIKEY_BACKEND_IDS)[number];

/** All six backends in a stable display order (API-key backends first). */
export const ALL_BACKEND_IDS: readonly BackendId[] = [
  ...APIKEY_BACKEND_IDS,
  ...SUBSCRIPTION_BACKEND_IDS,
];

const SUBSCRIPTION_SET: ReadonlySet<BackendId> = new Set(SUBSCRIPTION_BACKEND_IDS);
const ALL_SET: ReadonlySet<string> = new Set(ALL_BACKEND_IDS);

export function isSubscriptionBackend(id: BackendId): id is SubscriptionBackendId {
  return SUBSCRIPTION_SET.has(id);
}

export function backendGroup(id: BackendId): BackendGroup {
  return SUBSCRIPTION_SET.has(id) ? 'subscription' : 'apikey';
}

function toBackendId(value: unknown): BackendId | null {
  return typeof value === 'string' && ALL_SET.has(value) ? (value as BackendId) : null;
}

/** Backends marked as "experimental" (PLAN §3: Grok = experimental). */
export const EXPERIMENTAL_BACKEND_IDS: ReadonlySet<BackendId> = new Set<BackendId>(['grok-cli']);

/** Display names — never "Claude Code" (PLAN §3 Rule 5). */
export const BACKEND_DISPLAY_NAME: Record<BackendId, string> = {
  byok: 'Your own API key',
  'claude-sdk': 'Claude (Agent SDK, API key)',
  'claude-cli': 'Claude (subscription)',
  codex: 'Codex CLI (OpenAI)',
  'gemini-cli': 'Gemini CLI (Google)',
  'grok-cli': 'Grok CLI (xAI)',
};

export function backendDisplayName(id: BackendId): string {
  return BACKEND_DISPLAY_NAME[id];
}

/* ------------------------------------------------------------------ */
/* External onboarding links — official vendor domains only            */
/* ------------------------------------------------------------------ */

/**
 * Allowed registrable vendor domains for `shell.openExternal`. Only these may be
 * opened in the external browser (compliance/security). Everything else is
 * rejected — even if a remote or detection source provides it.
 */
export const ALLOWED_EXTERNAL_DOMAINS: readonly string[] = [
  'anthropic.com',
  'claude.com',
  'openai.com',
  'google.dev',
  'google.com',
  'x.ai',
];

/** true if `url` is https and lies on an official vendor domain. */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_EXTERNAL_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Fallback onboarding links (official vendor docs). An `installHintUrl` provided
 * by detection is preferred, as long as it passes the allowlist.
 */
const DEFAULT_INSTALL_HINTS: Partial<Record<BackendId, string>> = {
  'claude-cli': 'https://docs.claude.com/en/docs/claude-code/setup',
  codex: 'https://developers.openai.com/codex/cli/',
  'gemini-cli': 'https://ai.google.dev/gemini-api/docs',
  'grok-cli': 'https://docs.x.ai/docs/overview',
};

/** Picks the onboarding link to display: detection URL (if allowed), otherwise the fallback. */
export function pickInstallHint(id: BackendId, detected?: string): string | undefined {
  if (detected !== undefined && isAllowedExternalUrl(detected)) return detected;
  const fallback = DEFAULT_INSTALL_HINTS[id];
  return fallback !== undefined && isAllowedExternalUrl(fallback) ? fallback : undefined;
}

/* ------------------------------------------------------------------ */
/* Claude subscription: feature-flag notice + acknowledgment (PLAN §3)  */
/* ------------------------------------------------------------------ */

/** Backends that require a one-time notice before first use. */
export const BACKENDS_REQUIRING_NOTICE: ReadonlySet<BackendId> = new Set<BackendId>(['claude-cli']);

/** Structure of an in-app notice (concise, direct tone, no emojis). */
export interface BackendNotice {
  backendId: BackendId;
  title: string;
  paragraphs: readonly string[];
  termsUrl: string;
  termsLabel: string;
}

/**
 * Claude subscription notice (PLAN §3, Anthropic "unless previously approved").
 * Explains that the mode uses the user's OWN subscription through the official
 * CLI they installed and signed into themselves, that this app never touches any
 * token, and links to the Anthropic terms. Never "Claude Code" as a product name.
 */
export const CLAUDE_CLI_NOTICE: BackendNotice = {
  backendId: 'claude-cli',
  title: 'Use Claude (subscription)',
  paragraphs: [
    'This mode uses your own Claude subscription through the official Anthropic CLI that you installed on your machine and signed into yourself.',
    'Web AI Builder never reads, stores, or transmits any access token in the process. The login happens entirely within Anthropic’s own flow — this app only launches the unmodified official CLI.',
    'Using a subscription through third-party tools is only conditionally permitted by Anthropic ("unless previously approved"). Review Anthropic’s terms first. For stable everyday use, we recommend API-key mode.',
  ],
  termsUrl: 'https://www.anthropic.com/legal/consumer-terms',
  termsLabel: 'Anthropic terms of use',
};

const NOTICES: Partial<Record<BackendId, BackendNotice>> = {
  'claude-cli': CLAUDE_CLI_NOTICE,
};

export function noticeFor(id: BackendId): BackendNotice | null {
  return NOTICES[id] ?? null;
}

/* ---------------- Notice acknowledgment state machine ---------------- */

export type NoticeGateStatus = 'no-notice' | 'needs-ack' | 'ready';

/**
 * Feature-flag gate for a backend notice: does the backend need a notice, and
 * has it already been acknowledged?
 */
export function noticeGate(id: BackendId, acknowledged: ReadonlySet<BackendId>): NoticeGateStatus {
  if (!BACKENDS_REQUIRING_NOTICE.has(id)) return 'no-notice';
  return acknowledged.has(id) ? 'ready' : 'needs-ack';
}

/** Adds an acknowledgment (pure, no side effect on the input). */
export function applyAck(acknowledged: ReadonlySet<BackendId>, id: BackendId): Set<BackendId> {
  const next = new Set(acknowledged);
  next.add(id);
  return next;
}

/** States of the notice dialog in the renderer. */
export type AckFlowState = 'idle' | 'showing' | 'acknowledged';
export type AckFlowAction = { type: 'open' } | { type: 'acknowledge' } | { type: 'dismiss' };

/**
 * Pure state machine for the notice dialog: idle →(open)→ showing →(acknowledge)→
 * acknowledged; showing →(dismiss)→ idle. `acknowledged` is terminal.
 */
export function ackFlowReducer(state: AckFlowState, action: AckFlowAction): AckFlowState {
  switch (action.type) {
    case 'open':
      return state === 'acknowledged' ? state : 'showing';
    case 'acknowledge':
      return state === 'showing' ? 'acknowledged' : state;
    case 'dismiss':
      return state === 'showing' ? 'idle' : state;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Remote kill switch: schema, default, validation, resolution          */
/* ------------------------------------------------------------------ */

/** Kill-switch state of a subscription backend (PLAN §3 Rule 3). */
export interface BackendKillSwitch {
  enabled: boolean;
  /** Reason for the deactivation (for the UI). */
  reason?: string;
  /** Optional Markdown notice (remote communication to the user). */
  noticeMarkdown?: string;
}

export type KillSwitchMap = Partial<Record<SubscriptionBackendId, BackendKillSwitch>>;

/** The complete kill-switch record (bundled or remote). */
export interface KillSwitchConfig {
  version?: number;
  backends: KillSwitchMap;
}

/**
 * Bundled default (PLAN §3): all subscription backends active. Grok is marked
 * separately as "experimental" (see {@link EXPERIMENTAL_BACKEND_IDS}) — that is
 * not a kill-switch state but static metadata.
 */
export const BUNDLED_KILLSWITCH: KillSwitchConfig = {
  version: 1,
  backends: {
    'claude-cli': { enabled: true },
    codex: { enabled: true },
    'gemini-cli': { enabled: true },
    'grok-cli': { enabled: true },
  },
};

function coerceKillSwitchEntry(value: unknown): BackendKillSwitch | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return null;
  const entry: BackendKillSwitch = { enabled: obj.enabled };
  if (typeof obj.reason === 'string') entry.reason = obj.reason;
  if (typeof obj.noticeMarkdown === 'string') entry.noticeMarkdown = obj.noticeMarkdown;
  return entry;
}

/**
 * Defensively parses a kill-switch record (read from remote or the cache).
 * Returns `null` if it is structurally broken — the caller then IGNORES it
 * (fail-safe, PLAN §3). Unknown backend keys and invalid individual entries are
 * discarded, not the whole record.
 */
export function coerceKillSwitchConfig(value: unknown): KillSwitchConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const rawBackends = obj.backends;
  if (typeof rawBackends !== 'object' || rawBackends === null) return null;
  const source = rawBackends as Record<string, unknown>;

  const backends: KillSwitchMap = {};
  for (const id of SUBSCRIPTION_BACKEND_IDS) {
    const entry = coerceKillSwitchEntry(source[id]);
    if (entry !== null) backends[id] = entry;
  }
  const config: KillSwitchConfig = { backends };
  if (typeof obj.version === 'number') config.version = obj.version;
  return config;
}

/**
 * Effective kill switch = bundled default, overridden per subscription backend by
 * a valid remote entry. `null` (missing/broken remote) → the bundled default
 * alone.
 */
export function resolveKillSwitch(remote: KillSwitchConfig | null): KillSwitchConfig {
  const backends: KillSwitchMap = { ...BUNDLED_KILLSWITCH.backends };
  if (remote !== null) {
    for (const id of SUBSCRIPTION_BACKEND_IDS) {
      const entry = remote.backends[id];
      if (entry !== undefined) backends[id] = entry;
    }
  }
  return { version: remote?.version ?? BUNDLED_KILLSWITCH.version, backends };
}

/** Kill-switch state for ONE backend (API-key backends are always active). */
export function killSwitchFor(config: KillSwitchConfig, id: BackendId): BackendKillSwitch {
  if (!isSubscriptionBackend(id)) return { enabled: true };
  return config.backends[id] ?? { enabled: true };
}

/* ------------------------------------------------------------------ */
/* Availability: raw detection → normalized, merged view                */
/* ------------------------------------------------------------------ */

/**
 * Defensively normalized detection of a backend. Deliberately permissive so that
 * additive changes to `BackendAvailability` in @webaibuilder/agents (another
 * agent is currently reworking it) don't break this layer — the raw detection is
 * accepted as `unknown` and read defensively here.
 */
export interface RawBackendAvailability {
  backendId: BackendId;
  installed: boolean;
  loggedIn: boolean | 'unknown';
  version?: string;
  account?: string;
  installHintUrl?: string;
  experimental?: boolean;
}

function readLoggedIn(value: unknown): boolean | 'unknown' {
  if (value === true) return true;
  if (value === false) return false;
  return 'unknown';
}

/**
 * Defensively parses a raw detection object. Accepts both `backendId` (new form)
 * and `id` (existing M2 form). `null` if no known backend can be identified.
 */
export function coerceRawAvailability(value: unknown): RawBackendAvailability | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const id = toBackendId(obj.backendId) ?? toBackendId(obj.id);
  if (id === null) return null;

  const raw: RawBackendAvailability = {
    backendId: id,
    installed: obj.installed === true,
    loggedIn: readLoggedIn(obj.loggedIn),
  };
  if (typeof obj.version === 'string') raw.version = obj.version;
  if (typeof obj.account === 'string') raw.account = obj.account;
  if (typeof obj.installHintUrl === 'string') raw.installHintUrl = obj.installHintUrl;
  if (obj.experimental === true) raw.experimental = true;
  return raw;
}

/** Renderer-friendly, merged view of a backend. */
export interface BackendAvailabilityView {
  backendId: BackendId;
  group: BackendGroup;
  installed: boolean;
  loggedIn: boolean | 'unknown';
  version?: string;
  account?: string;
  /** Official onboarding link (allowed vendor domain only). */
  installHintUrl?: string;
  experimental: boolean;
  /** Effectively active? Only subscription backends can be off via kill switch. */
  enabled: boolean;
  /** Reason for the kill-switch deactivation. */
  disabledReason?: string;
  /** Optional remote Markdown notice (kill-switch communication). */
  noticeMarkdown?: string;
  /** Requires a one-time notice to acknowledge (feature flag). */
  requiresAck: boolean;
  /** Notice already acknowledged? */
  acknowledged: boolean;
}

/** Synthesize an empty (not installed) backend if detection omits it. */
function emptyRaw(id: BackendId): RawBackendAvailability {
  return { backendId: id, installed: false, loggedIn: 'unknown' };
}

/**
 * Merges a raw detection with the effective kill switch and the acknowledgment
 * state into the renderer view. A backend disabled via kill switch is reported
 * with `enabled:false` (+ reason).
 */
export function mergeAvailability(
  raw: RawBackendAvailability,
  killSwitch: KillSwitchConfig,
  acknowledged: ReadonlySet<BackendId>,
): BackendAvailabilityView {
  const id = raw.backendId;
  const ks = killSwitchFor(killSwitch, id);
  const experimental = raw.experimental === true || EXPERIMENTAL_BACKEND_IDS.has(id);

  const view: BackendAvailabilityView = {
    backendId: id,
    group: backendGroup(id),
    installed: raw.installed,
    loggedIn: raw.loggedIn,
    experimental,
    enabled: ks.enabled,
    requiresAck: BACKENDS_REQUIRING_NOTICE.has(id),
    acknowledged: acknowledged.has(id),
  };
  if (raw.version !== undefined) view.version = raw.version;
  if (raw.account !== undefined) view.account = raw.account;
  const hint = pickInstallHint(id, raw.installHintUrl);
  if (hint !== undefined) view.installHintUrl = hint;
  if (!ks.enabled && ks.reason !== undefined) view.disabledReason = ks.reason;
  if (ks.noticeMarkdown !== undefined) view.noticeMarkdown = ks.noticeMarkdown;
  return view;
}

/**
 * Builds the complete, ordered view of all six backends. If one is missing from
 * detection, it is defensively added as "not installed".
 */
export function buildAvailabilityViews(
  raws: readonly RawBackendAvailability[],
  killSwitch: KillSwitchConfig,
  acknowledged: ReadonlySet<BackendId>,
): BackendAvailabilityView[] {
  const byId = new Map<BackendId, RawBackendAvailability>();
  for (const raw of raws) byId.set(raw.backendId, raw);
  return ALL_BACKEND_IDS.map((id) =>
    mergeAvailability(byId.get(id) ?? emptyRaw(id), killSwitch, acknowledged),
  );
}

/** Complete picker payload sent to the renderer. */
export interface BackendPickerState {
  backends: BackendAvailabilityView[];
  acknowledged: BackendId[];
}

/* ------------------------------------------------------------------ */
/* Status label + selectability (subscription backends)                */
/* ------------------------------------------------------------------ */

/**
 * Status label for a subscription backend (PLAN §5):
 *  "not installed" · "not logged in" · "found" · "logged in as …" · or the reason
 *  when the kill switch is active.
 */
export function subscriptionStatusLabel(view: BackendAvailabilityView): string {
  if (!view.enabled) return view.disabledReason ?? 'temporarily disabled';
  if (!view.installed) return 'not installed';
  if (view.loggedIn === false) return 'found · not logged in';
  if (view.loggedIn === true) {
    return view.account !== undefined && view.account !== ''
      ? `logged in as ${view.account}`
      : 'found · logged in';
  }
  // loggedIn === 'unknown' → installed, login status not determinable.
  return 'found';
}

export type BackendBlockReason =
  | 'kill-switch'
  | 'not-installed'
  | 'not-logged-in'
  | 'needs-ack'
  | null;

/**
 * Why a backend is currently NOT usable (or `null` if usable). API-key backends
 * are never blocked here (their "ready" state depends on the API key, which is
 * managed separately in Settings).
 */
export function backendBlockReason(view: BackendAvailabilityView): BackendBlockReason {
  if (view.group === 'apikey') return null;
  if (!view.enabled) return 'kill-switch';
  if (!view.installed) return 'not-installed';
  if (view.loggedIn === false) return 'not-logged-in';
  if (view.requiresAck && !view.acknowledged) return 'needs-ack';
  return null;
}

/** Is the backend selectable/usable? */
export function isBackendSelectable(view: BackendAvailabilityView): boolean {
  return backendBlockReason(view) === null;
}

/* ------------------------------------------------------------------ */
/* Activating a subscription backend as the active (turn-driving) backend */
/* ------------------------------------------------------------------ */

/**
 * Authoritative activation check for a subscription backend (main process, PLAN
 * §3/§4). Returns an actionable error message if the backend may NOT be set as
 * the active backend (not installed, not logged in, off via kill switch, or
 * notice not acknowledged) — otherwise `null`. Same blocking logic as in the UI
 * ({@link backendBlockReason}), so the renderer and main decide identically.
 */
export function subscriptionActivationError(view: BackendAvailabilityView): string | null {
  const name = backendDisplayName(view.backendId);
  switch (backendBlockReason(view)) {
    case null:
      return null;
    case 'kill-switch':
      return view.disabledReason ?? `${name} is currently disabled.`;
    case 'not-installed':
      return `${name} is not installed. Install the official CLI and sign in with your subscription, then try again.`;
    case 'not-logged-in':
      return `${name} is installed but not signed in. Sign in to the CLI with your subscription, then try again.`;
    case 'needs-ack':
      return `Acknowledge the notice for ${name} before using it as the active backend.`;
  }
}

/**
 * Pure decision of what a click on a subscription backend in the picker triggers:
 *  - `activate`: ready → set as the active backend (`settings.set`)
 *  - `acknowledge`: acknowledge the one-time notice first
 *  - `blocked`: not usable → open the onboarding link + show a hint
 */
export type BackendSelectAction =
  | { kind: 'activate' }
  | { kind: 'acknowledge' }
  | { kind: 'blocked'; hintUrl?: string; message: string };

export function backendSelectAction(view: BackendAvailabilityView): BackendSelectAction {
  const reason = backendBlockReason(view);
  if (reason === null) return { kind: 'activate' };
  if (reason === 'needs-ack') return { kind: 'acknowledge' };
  const message =
    reason === 'kill-switch'
      ? 'This backend is currently disabled.'
      : reason === 'not-logged-in'
        ? 'Sign in to the CLI first (link opened).'
        : 'Install the CLI first (link opened).';
  return {
    kind: 'blocked',
    ...(view.installHintUrl !== undefined ? { hintUrl: view.installHintUrl } : {}),
    message,
  };
}

/**
 * Status-bar label for the active backend (PLAN §5). Subscription backends run
 * through their own CLI and have no app-managed key — no "(no key)" suffix.
 */
export function activeBackendStatusLabel(backendId: BackendId, hasApiKey: boolean): string {
  const name = backendDisplayName(backendId);
  if (isSubscriptionBackend(backendId)) return name;
  return hasApiKey ? name : `${name} (no key)`;
}

/* ------------------------------------------------------------------ */
/* Chat readiness: unlocks the chat composer                           */
/* ------------------------------------------------------------------ */

export type ChatBlockReason = 'no-settings' | 'missing-key' | null;

/**
 * Why the chat is currently NOT ready to send (or `null` if ready) — the single
 * shared source for unlocking the composer (previously inline logic in
 * Workbench.tsx). As the active backend, subscription backends are always ready,
 * since the main process authoritatively checked their usability at activation
 * time. API-key backends need a key — keychain OR environment variable, both
 * already captured in `hasApiKey` (main/settingsStore.ts).
 */
export function chatBlockReason(
  settings: { backendId: BackendId; hasApiKey: boolean } | null,
): ChatBlockReason {
  if (settings === null) return 'no-settings';
  if (isSubscriptionBackend(settings.backendId)) return null;
  return settings.hasApiKey ? null : 'missing-key';
}

/** The chat empty-state's recommendation for how the user unlocks the chat. */
export type ChatSetupCta =
  | { kind: 'use-subscription'; backendId: SubscriptionBackendId; needsAck: boolean }
  | { kind: 'enter-key' };

/**
 * Pure recommendation for the chat empty-state: the first installed, active,
 * non-experimental subscription backend that is not explicitly logged out —
 * otherwise the API-key path. `needsAck` tells the UI that the one-time notice
 * must be acknowledged before activation (compliance, PLAN §3 — the notice is
 * shown in a guided way, never skipped).
 */
export function recommendChatSetup(views: readonly BackendAvailabilityView[]): ChatSetupCta {
  for (const id of SUBSCRIPTION_BACKEND_IDS) {
    const view = views.find((v) => v.backendId === id);
    if (view === undefined) continue;
    if (!view.installed || !view.enabled || view.experimental) continue;
    if (view.loggedIn === false) continue;
    return {
      kind: 'use-subscription',
      backendId: id,
      needsAck: view.requiresAck && !view.acknowledged,
    };
  }
  return { kind: 'enter-key' };
}
