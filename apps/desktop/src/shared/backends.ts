/**
 * Backend-Erkennung, Onboarding und Remote-Kill-Switch (PLAN §3/§4, M4) —
 * die reine, umgebungsneutrale Logik. Von main, preload und renderer geteilt
 * und headless testbar (kein node/electron/DOM).
 *
 * Compliance (PLAN §3, nicht verhandelbar):
 *  - Abo-Backends laufen ausschließlich über die vom Nutzer selbst installierte
 *    und selbst eingeloggte offizielle Vendor-CLI. Diese App liest, speichert
 *    oder überträgt NIEMALS ein Abo-Token. Es gibt hier bewusst KEINE
 *    Base-URL-/Token-Override-Logik.
 *  - Pro Abo-Anbieter existiert ein Remote-Kill-Switch (Regel 3): ein Abo-Pfad
 *    muss ohne Release über Nacht deaktivierbar sein. Der Kill-Switch ist
 *    fail-safe (Netzfehler → letzter Cache → gebündelter Default).
 *  - Der Claude-Abo-Pfad (`claude-cli`) steht hinter einem Feature-Flag samt
 *    In-App-Hinweis, den der Nutzer einmalig bestätigen muss.
 *  - Branding: nie „Claude Code" als Produktname; „Claude (Abo)" bzw.
 *    „works with Claude Agent"-Formulierungen sind ok.
 */

import type { BackendId } from '@webaibuilder/core';

/* ------------------------------------------------------------------ */
/* Gruppierung: Abo vs. API-Key                                        */
/* ------------------------------------------------------------------ */

export type BackendGroup = 'subscription' | 'apikey';

/** Abo-Backends (offizielle Vendor-CLI des Nutzers, PLAN §3/§4). */
export const SUBSCRIPTION_BACKEND_IDS = ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'] as const;
/** API-Key-Backends (Fundament + Fallback, PLAN §3 Regel 4). */
export const APIKEY_BACKEND_IDS = ['byok', 'claude-sdk'] as const;

export type SubscriptionBackendId = (typeof SUBSCRIPTION_BACKEND_IDS)[number];
export type ApiKeyBackendId = (typeof APIKEY_BACKEND_IDS)[number];

/** Alle sechs Backends in stabiler Anzeigereihenfolge (API-Key zuerst). */
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

/** Als „experimentell" markierte Backends (PLAN §3: Grok = experimentell). */
export const EXPERIMENTAL_BACKEND_IDS: ReadonlySet<BackendId> = new Set<BackendId>(['grok-cli']);

/** Anzeigenamen — nie „Claude Code" (PLAN §3 Regel 5). */
export const BACKEND_DISPLAY_NAME: Record<BackendId, string> = {
  byok: 'Eigener API-Key',
  'claude-sdk': 'Claude (Agent-SDK, API-Key)',
  'claude-cli': 'Claude (Abo)',
  codex: 'Codex CLI (OpenAI)',
  'gemini-cli': 'Gemini CLI (Google)',
  'grok-cli': 'Grok CLI (xAI)',
};

export function backendDisplayName(id: BackendId): string {
  return BACKEND_DISPLAY_NAME[id];
}

/* ------------------------------------------------------------------ */
/* Externe Onboarding-Links — nur offizielle Vendor-Domains            */
/* ------------------------------------------------------------------ */

/**
 * Zugelassene registrierbare Vendor-Domains für `shell.openExternal`. Nur diese
 * dürfen im externen Browser geöffnet werden (Compliance/Sicherheit). Alles
 * andere wird abgelehnt — auch wenn eine Remote-/Detection-Quelle es liefert.
 */
export const ALLOWED_EXTERNAL_DOMAINS: readonly string[] = [
  'anthropic.com',
  'claude.com',
  'openai.com',
  'google.dev',
  'google.com',
  'x.ai',
];

/** true, wenn `url` https ist und auf einer offiziellen Vendor-Domain liegt. */
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
 * Fallback-Onboarding-Links (offizielle Vendor-Docs). Bevorzugt wird ein von der
 * Detection gelieferter `installHintUrl`, sofern er die Allowlist besteht.
 */
const DEFAULT_INSTALL_HINTS: Partial<Record<BackendId, string>> = {
  'claude-cli': 'https://docs.claude.com/en/docs/claude-code/setup',
  codex: 'https://developers.openai.com/codex/cli/',
  'gemini-cli': 'https://ai.google.dev/gemini-api/docs',
  'grok-cli': 'https://docs.x.ai/docs/overview',
};

/** Wählt den anzuzeigenden Onboarding-Link: Detection-URL (falls erlaubt) sonst Fallback. */
export function pickInstallHint(id: BackendId, detected?: string): string | undefined {
  if (detected !== undefined && isAllowedExternalUrl(detected)) return detected;
  const fallback = DEFAULT_INSTALL_HINTS[id];
  return fallback !== undefined && isAllowedExternalUrl(fallback) ? fallback : undefined;
}

/* ------------------------------------------------------------------ */
/* Claude-Abo: Feature-Flag-Hinweis + Bestätigung (PLAN §3)            */
/* ------------------------------------------------------------------ */

/** Backends, die vor der ersten Nutzung einen einmaligen Hinweis erfordern. */
export const BACKENDS_REQUIRING_NOTICE: ReadonlySet<BackendId> = new Set<BackendId>(['claude-cli']);

/** Struktur eines In-App-Hinweises (deutsch, Du-Form, ohne Emojis). */
export interface BackendNotice {
  backendId: BackendId;
  title: string;
  paragraphs: readonly string[];
  termsUrl: string;
  termsLabel: string;
}

/**
 * Claude-Abo-Hinweis (PLAN §3, Anthropic „unless previously approved"). Erklärt,
 * dass der Modus das EIGENE Abo über die selbst installierte, selbst eingeloggte
 * offizielle CLI nutzt, dass diese App keine Token anfasst, und verlinkt die
 * Anthropic-Bedingungen. Nie „Claude Code" als Produktname.
 */
export const CLAUDE_CLI_NOTICE: BackendNotice = {
  backendId: 'claude-cli',
  title: 'Claude (Abo) verwenden',
  paragraphs: [
    'Dieser Modus nutzt dein eigenes Claude-Abo über die offizielle Anthropic-CLI, die du selbst auf deinem Rechner installiert und in die du dich selbst eingeloggt hast.',
    'Web AI Builder liest, speichert oder überträgt dabei keine Zugangs-Token. Der Login passiert ausschließlich im Flow von Anthropic — diese App startet nur die unveränderte offizielle CLI.',
    'Die Nutzung eines Abos über Dritt-Werkzeuge ist von Anthropic nur eingeschränkt erlaubt („unless previously approved"). Prüfe vorab die Bedingungen von Anthropic. Für den stabilen Standardbetrieb empfehlen wir den API-Key-Modus.',
  ],
  termsUrl: 'https://www.anthropic.com/legal/consumer-terms',
  termsLabel: 'Anthropic-Nutzungsbedingungen',
};

const NOTICES: Partial<Record<BackendId, BackendNotice>> = {
  'claude-cli': CLAUDE_CLI_NOTICE,
};

export function noticeFor(id: BackendId): BackendNotice | null {
  return NOTICES[id] ?? null;
}

/* ---------------- Notice-Bestätigungs-Automat ---------------- */

export type NoticeGateStatus = 'no-notice' | 'needs-ack' | 'ready';

/**
 * Feature-Flag-Gate für einen Backend-Hinweis: braucht das Backend einen
 * Hinweis, und wurde er schon bestätigt?
 */
export function noticeGate(id: BackendId, acknowledged: ReadonlySet<BackendId>): NoticeGateStatus {
  if (!BACKENDS_REQUIRING_NOTICE.has(id)) return 'no-notice';
  return acknowledged.has(id) ? 'ready' : 'needs-ack';
}

/** Fügt eine Bestätigung hinzu (rein, ohne Seiteneffekt auf die Eingabe). */
export function applyAck(acknowledged: ReadonlySet<BackendId>, id: BackendId): Set<BackendId> {
  const next = new Set(acknowledged);
  next.add(id);
  return next;
}

/** Zustände des Hinweis-Dialogs im Renderer. */
export type AckFlowState = 'idle' | 'showing' | 'acknowledged';
export type AckFlowAction = { type: 'open' } | { type: 'acknowledge' } | { type: 'dismiss' };

/**
 * Reiner Automat für den Hinweis-Dialog: idle →(open)→ showing →(acknowledge)→
 * acknowledged; showing →(dismiss)→ idle. `acknowledged` ist terminal.
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
/* Remote-Kill-Switch: Schema, Default, Validierung, Auflösung          */
/* ------------------------------------------------------------------ */

/** Kill-Switch-Zustand eines Abo-Backends (PLAN §3 Regel 3). */
export interface BackendKillSwitch {
  enabled: boolean;
  /** Grund der Deaktivierung (deutsch, für die UI). */
  reason?: string;
  /** Optionaler Markdown-Hinweis (Remote-Kommunikation an den Nutzer). */
  noticeMarkdown?: string;
}

export type KillSwitchMap = Partial<Record<SubscriptionBackendId, BackendKillSwitch>>;

/** Gesamter Kill-Switch-Datensatz (gebündelt oder remote). */
export interface KillSwitchConfig {
  version?: number;
  backends: KillSwitchMap;
}

/**
 * Gebündelter Default (PLAN §3): alle Abo-Backends aktiv. Grok wird separat als
 * „experimentell" markiert (siehe {@link EXPERIMENTAL_BACKEND_IDS}) — das ist
 * kein Kill-Switch-Zustand, sondern statische Metadaten.
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
 * Liest einen (remote oder aus dem Cache gelesenen) Kill-Switch-Datensatz
 * defensiv ein. Gibt `null` zurück, wenn er strukturell kaputt ist — der Aufrufer
 * IGNORIERT ihn dann (fail-safe, PLAN §3). Unbekannte Backend-Schlüssel und
 * ungültige Einzeleinträge werden verworfen, nicht der ganze Datensatz.
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
 * Effektiver Kill-Switch = gebündelter Default, pro Abo-Backend von einem
 * gültigen Remote-Eintrag überschrieben. `null` (kein/kaputtes Remote) →
 * reiner gebündelter Default.
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

/** Kill-Switch-Zustand für EIN Backend (API-Key-Backends sind immer aktiv). */
export function killSwitchFor(config: KillSwitchConfig, id: BackendId): BackendKillSwitch {
  if (!isSubscriptionBackend(id)) return { enabled: true };
  return config.backends[id] ?? { enabled: true };
}

/* ------------------------------------------------------------------ */
/* Availability: rohe Detection → normalisierte, gemergte Sicht         */
/* ------------------------------------------------------------------ */

/**
 * Defensiv normalisierte Detection eines Backends. Bewusst permissiv, damit
 * additive Änderungen an `BackendAvailability` in @webaibuilder/agents (anderer
 * Agent baut sie gerade um) diese Schicht nicht brechen — die rohe Detection
 * wird als `unknown` entgegengenommen und hier defensiv gelesen.
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
 * Liest ein rohes Detection-Objekt defensiv ein. Akzeptiert sowohl `backendId`
 * (neue Form) als auch `id` (bestehende M2-Form). `null`, wenn kein bekanntes
 * Backend erkennbar ist.
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

/** Renderer-taugliche, gemergte Sicht auf ein Backend. */
export interface BackendAvailabilityView {
  backendId: BackendId;
  group: BackendGroup;
  installed: boolean;
  loggedIn: boolean | 'unknown';
  version?: string;
  account?: string;
  /** Offizieller Onboarding-Link (nur erlaubte Vendor-Domain). */
  installHintUrl?: string;
  experimental: boolean;
  /** Effektiv aktiv? Nur Abo-Backends können per Kill-Switch aus sein. */
  enabled: boolean;
  /** Grund der Kill-Switch-Deaktivierung (deutsch). */
  disabledReason?: string;
  /** Optionaler Remote-Markdown-Hinweis (Kill-Switch-Kommunikation). */
  noticeMarkdown?: string;
  /** Erfordert einen einmalig zu bestätigenden Hinweis (Feature-Flag). */
  requiresAck: boolean;
  /** Hinweis bereits bestätigt? */
  acknowledged: boolean;
}

/** Ein leeres (nicht installiertes) Backend synthetisieren, falls die Detection es auslässt. */
function emptyRaw(id: BackendId): RawBackendAvailability {
  return { backendId: id, installed: false, loggedIn: 'unknown' };
}

/**
 * Mergt eine rohe Detection mit dem effektiven Kill-Switch und dem
 * Bestätigungs-Zustand zur Renderer-Sicht. Ein per Kill-Switch deaktiviertes
 * Backend wird mit `enabled:false` (+ Grund) gemeldet.
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
 * Baut die vollständige, geordnete Sicht auf alle sechs Backends. Fehlt eines in
 * der Detection, wird es defensiv als „nicht installiert" ergänzt.
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

/** Vollständige Picker-Nutzlast an den Renderer. */
export interface BackendPickerState {
  backends: BackendAvailabilityView[];
  acknowledged: BackendId[];
}

/* ------------------------------------------------------------------ */
/* Status-Label + Auswählbarkeit (Abo-Backends)                        */
/* ------------------------------------------------------------------ */

/**
 * Deutsches Status-Label für ein Abo-Backend (PLAN §5, Du-Form):
 *  „nicht installiert" · „nicht eingeloggt" · „gefunden" · „eingeloggt als …" ·
 *  bei Kill-Switch der Grund.
 */
export function subscriptionStatusLabel(view: BackendAvailabilityView): string {
  if (!view.enabled) return view.disabledReason ?? 'vorübergehend deaktiviert';
  if (!view.installed) return 'nicht installiert';
  if (view.loggedIn === false) return 'gefunden · nicht eingeloggt';
  if (view.loggedIn === true) {
    return view.account !== undefined && view.account !== ''
      ? `eingeloggt als ${view.account}`
      : 'gefunden · eingeloggt';
  }
  // loggedIn === 'unknown' → installiert, Login nicht ermittelbar.
  return 'gefunden';
}

export type BackendBlockReason =
  | 'kill-switch'
  | 'not-installed'
  | 'not-logged-in'
  | 'needs-ack'
  | null;

/**
 * Warum ein Backend gerade NICHT nutzbar ist (oder `null`, wenn nutzbar).
 * API-Key-Backends sind hier nie blockiert (ihr „bereit" hängt am API-Key, der
 * getrennt in den Einstellungen verwaltet wird).
 */
export function backendBlockReason(view: BackendAvailabilityView): BackendBlockReason {
  if (view.group === 'apikey') return null;
  if (!view.enabled) return 'kill-switch';
  if (!view.installed) return 'not-installed';
  if (view.loggedIn === false) return 'not-logged-in';
  if (view.requiresAck && !view.acknowledged) return 'needs-ack';
  return null;
}

/** Ist das Backend auswählbar/nutzbar? */
export function isBackendSelectable(view: BackendAvailabilityView): boolean {
  return backendBlockReason(view) === null;
}

/* ------------------------------------------------------------------ */
/* Aktivierung eines Abo-Backends als aktives (turn-treibendes) Backend  */
/* ------------------------------------------------------------------ */

/**
 * Autoritative Aktivierungsprüfung für ein Abo-Backend (Main-Prozess, PLAN §3/§4).
 * Gibt eine deutsche, handlungsleitende Fehlermeldung zurück, wenn das Backend
 * NICHT als aktives Backend gesetzt werden darf (nicht installiert, nicht
 * eingeloggt, per Kill-Switch aus oder Hinweis nicht bestätigt) — sonst `null`.
 * Dieselbe Blockier-Logik wie in der UI ({@link backendBlockReason}), damit
 * Renderer und Main identisch entscheiden.
 */
export function subscriptionActivationError(view: BackendAvailabilityView): string | null {
  const name = backendDisplayName(view.backendId);
  switch (backendBlockReason(view)) {
    case null:
      return null;
    case 'kill-switch':
      return view.disabledReason ?? `${name} ist derzeit deaktiviert.`;
    case 'not-installed':
      return `${name} ist nicht installiert. Installiere die offizielle CLI und logge dich mit deinem Abo ein, dann versuch es erneut.`;
    case 'not-logged-in':
      return `${name} ist installiert, aber nicht eingeloggt. Melde dich in der CLI mit deinem Abo an, dann versuch es erneut.`;
    case 'needs-ack':
      return `Bestätige zuerst den Hinweis zu ${name}, bevor du es als aktives Backend nutzt.`;
  }
}

/**
 * Reine Entscheidung, was ein Klick auf ein Abo-Backend im Picker auslöst:
 *  - `activate`: bereit → als aktives Backend setzen (`settings.set`)
 *  - `acknowledge`: erst den einmaligen Hinweis bestätigen
 *  - `blocked`: nicht nutzbar → Onboarding-Link öffnen + deutschen Hinweis zeigen
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
      ? 'Dieses Backend ist derzeit deaktiviert.'
      : reason === 'not-logged-in'
        ? 'Zuerst in der CLI anmelden (Link geöffnet).'
        : 'Zuerst die CLI installieren (Link geöffnet).';
  return {
    kind: 'blocked',
    ...(view.installHintUrl !== undefined ? { hintUrl: view.installHintUrl } : {}),
    message,
  };
}

/**
 * Statusleisten-Label für das aktive Backend (PLAN §5). Abo-Backends laufen über
 * die eigene CLI und haben keinen app-verwalteten Key — kein „(kein Key)"-Zusatz.
 */
export function activeBackendStatusLabel(backendId: BackendId, hasApiKey: boolean): string {
  const name = backendDisplayName(backendId);
  if (isSubscriptionBackend(backendId)) return name;
  return hasApiKey ? name : `${name} (kein Key)`;
}

/* ------------------------------------------------------------------ */
/* Chat-Readiness: schaltet den Chat-Composer frei                     */
/* ------------------------------------------------------------------ */

export type ChatBlockReason = 'no-settings' | 'missing-key' | null;

/**
 * Warum der Chat gerade NICHT sendbereit ist (oder `null`, wenn bereit) — die
 * eine geteilte Quelle für die Composer-Freischaltung (vorher Inline-Logik in
 * Workbench.tsx). Abo-Backends sind als aktives Backend immer bereit, denn ihre
 * Nutzbarkeit hat der Main-Prozess bei der Aktivierung autoritativ geprüft.
 * API-Key-Backends brauchen einen Key — Schlüsselbund ODER Umgebungsvariable,
 * beides steckt bereits in `hasApiKey` (main/settingsStore.ts).
 */
export function chatBlockReason(
  settings: { backendId: BackendId; hasApiKey: boolean } | null,
): ChatBlockReason {
  if (settings === null) return 'no-settings';
  if (isSubscriptionBackend(settings.backendId)) return null;
  return settings.hasApiKey ? null : 'missing-key';
}

/** Empfehlung des Chat-Empty-States, wie der Nutzer den Chat freischaltet. */
export type ChatSetupCta =
  | { kind: 'use-subscription'; backendId: SubscriptionBackendId; needsAck: boolean }
  | { kind: 'enter-key' };

/**
 * Reine Empfehlung für den Chat-Empty-State: das erste installierte, aktive,
 * nicht-experimentelle Abo-Backend, das nicht ausdrücklich ausgeloggt ist —
 * sonst der API-Key-Pfad. `needsAck` sagt der UI, dass vor der Aktivierung der
 * einmalige Hinweis bestätigt werden muss (Compliance, PLAN §3 — der Hinweis
 * wird geführt angezeigt, nie übersprungen).
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
