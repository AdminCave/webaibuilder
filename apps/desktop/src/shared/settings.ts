/**
 * KI-Backend-Einstellungen (PLAN §4/§6, M2 + M4).
 *
 * Turn-treibendes Backend kann jedes der sechs Backends sein:
 *  - API-Key-Backends: `byok` (Vercel AI SDK, eigener API-Key + Provider +
 *    Modell) und `claude-sdk` (@anthropic-ai/claude-agent-sdk, API-Key + Modell).
 *  - Abo-/CLI-Backends (M4): `claude-cli`, `codex`, `gemini-cli`, `grok-cli` —
 *    sie spawnen die vom Nutzer selbst installierte, selbst eingeloggte offizielle
 *    Vendor-CLI (PLAN §3). Sie brauchen KEINEN app-verwalteten API-Key und haben
 *    kein Provider-/Modell-Konzept; Modell/Provider bleiben für sie bewusst leer.
 *
 * Ob ein Abo-Backend überhaupt als aktives Backend gesetzt werden darf, prüft der
 * Main-Prozess autoritativ gegen die Erkennung + Kill-Switch + Bestätigung
 * (siehe main/settingsStore.ts `applySettingsUpdate` und shared/backends.ts).
 *
 * Secret-Handling (PLAN §4, Sicherheit): Der API-Key wird NICHT im Klartext auf
 * die Platte geschrieben (Linux-Plaintext-Falle). Seit M3 liegt er im
 * OS-Schlüsselbund (@napi-rs/keyring, siehe main/secrets.ts) — genau wie die
 * Deploy-Credentials. Fehlt ein Systemschlüsselbund (headless Linux, Sway/
 * Hyprland ohne Secret Service), fällt der Main-Prozess bewusst auf einen
 * reinen In-Memory-Speicher für die laufende Sitzung zurück und meldet das über
 * `keychainAvailable` an die UI (kein stiller Klartext).
 *
 * Umgebungsneutral (kein node/electron/DOM) — von main, preload und renderer
 * gemeinsam genutzt und headless testbar.
 */

import type { BackendId } from '@webaibuilder/core';

import { isSubscriptionBackend } from './backends';

/**
 * Als aktives (turn-treibendes) Backend nutzbare IDs — seit M4 alle sechs.
 * Ob ein Abo-Backend tatsächlich gesetzt werden darf, entscheidet zusätzlich der
 * Main-Prozess anhand der Erkennung (installiert/eingeloggt/Kill-Switch/Hinweis).
 */
export type ActiveBackendId = BackendId;

/** Provider für den `byok`-Adapter (Vercel AI SDK v6). */
export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'xai';

export const ACTIVE_BACKEND_IDS: readonly ActiveBackendId[] = [
  'byok',
  'claude-sdk',
  'claude-cli',
  'codex',
  'gemini-cli',
  'grok-cli',
];
export const BYOK_PROVIDERS: readonly ByokProvider[] = ['anthropic', 'openai', 'google', 'xai'];

/** Persistierbarer, secret-freier Teil der Einstellungen. */
export interface AgentSettingsData {
  backendId: ActiveBackendId;
  /** Nur für `byok` relevant. */
  provider: ByokProvider;
  /** Modell-Override; leer = Backend-Default. */
  model: string;
}

/**
 * Was der Renderer sieht: die secret-freien Daten plus zwei abgeleitete Flags.
 * Der Key selbst wird nie an den Renderer gegeben.
 *  - `hasApiKey`: liegt für das aktuelle Backend/Provider ein Key vor?
 *  - `keychainAvailable`: gibt es einen OS-Schlüsselbund? Ist er false, hält der
 *    Main-Prozess Secrets nur sitzungsweise im Speicher (siehe Warnung unten).
 */
export interface AgentSettings extends AgentSettingsData {
  hasApiKey: boolean;
  keychainAvailable: boolean;
}

/**
 * Deutsche Warnung für die UI, wenn kein Systemschlüsselbund gefunden wurde
 * (PLAN §4, Sicherheit). Kein stiller Klartext — der Nutzer erfährt, dass
 * Zugangsdaten nur diese Sitzung überleben.
 */
export const KEYCHAIN_UNAVAILABLE_WARNING =
  'Kein Systemschlüsselbund gefunden — Zugangsdaten werden nur für diese Sitzung im Speicher gehalten.';

/** Was der Renderer setzen darf. `apiKey`: string setzt, null löscht, undefined lässt unverändert. */
export interface AgentSettingsInput {
  backendId?: ActiveBackendId;
  provider?: ByokProvider;
  model?: string;
  apiKey?: string | null;
}

/**
 * Sinnvolle Default-Modelle. Anthropic-Pfade nutzen Claude Opus 4.8
 * (`claude-opus-4-8`, aktuelles Opus-Modell). Für die übrigen byok-Provider
 * bleibt das Modell leer — der Nutzer trägt die Modell-ID ein, damit hier keine
 * womöglich veraltete Fremd-ID hartkodiert wird.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';

const DEFAULT_BYOK_MODEL: Record<ByokProvider, string> = {
  anthropic: DEFAULT_CLAUDE_MODEL,
  openai: '',
  google: '',
  xai: '',
};

export const DEFAULT_AGENT_SETTINGS: AgentSettingsData = {
  backendId: 'byok',
  provider: 'anthropic',
  model: DEFAULT_CLAUDE_MODEL,
};

function isActiveBackend(value: unknown): value is ActiveBackendId {
  return typeof value === 'string' && (ACTIVE_BACKEND_IDS as readonly string[]).includes(value);
}

function isProvider(value: unknown): value is ByokProvider {
  return typeof value === 'string' && (BYOK_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Führt ein (Teil-)Update auf einen gültigen, vollständigen Datensatz zusammen.
 * Ungültige Werte fallen auf den bestehenden Wert zurück. Der `model`-Wert wird
 * nur getrimmt; ein leerer Wert bedeutet „Backend-Default".
 */
export function mergeAgentSettings(
  current: AgentSettingsData,
  patch: AgentSettingsInput,
): AgentSettingsData {
  const backendId = isActiveBackend(patch.backendId) ? patch.backendId : current.backendId;
  const provider = isProvider(patch.provider) ? patch.provider : current.provider;
  const model = patch.model !== undefined ? patch.model.trim() : current.model;
  return { backendId, provider, model };
}

/** Liest einen unbekannten (z. B. von der Platte gelesenen) Wert defensiv ein. */
export function coerceAgentSettings(value: unknown): AgentSettingsData {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_AGENT_SETTINGS };
  }
  return mergeAgentSettings(DEFAULT_AGENT_SETTINGS, value as AgentSettingsInput);
}

/**
 * Modell, das effektiv an `createBackend` geht (Override oder Provider-Default).
 * Abo-/CLI-Backends haben kein Modell-Konzept — die Vendor-CLI bestimmt es
 * selbst; hier bleibt es leer (createBackend ignoriert es für CLI-Backends).
 */
export function effectiveModel(data: AgentSettingsData): string {
  if (isSubscriptionBackend(data.backendId)) return '';
  if (data.model.trim() !== '') return data.model.trim();
  if (data.backendId === 'claude-sdk') return DEFAULT_CLAUDE_MODEL;
  return DEFAULT_BYOK_MODEL[data.provider];
}

/**
 * Provider, unter dem der API-Key im Schlüsselbund abgelegt wird. `claude-sdk`
 * spricht immer Anthropic, nutzt also denselben Anthropic-Key wie `byok` mit
 * Provider `anthropic` — der Key wird pro Provider (nicht pro Backend)
 * gespeichert und geteilt. Für `byok` gilt der gewählte Provider.
 */
export function effectiveProvider(backendId: ActiveBackendId, provider: ByokProvider): ByokProvider {
  return backendId === 'claude-sdk' ? 'anthropic' : provider;
}
