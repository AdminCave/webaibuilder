/**
 * KI-Backend-Einstellungen (PLAN §4/§6, M2).
 *
 * In M2 sind die erreichbaren Backends `byok` (Vercel AI SDK, eigener
 * API-Key + Provider + Modell) und `claude-sdk` (@anthropic-ai/claude-agent-sdk,
 * API-Key + Modell). Die übrigen Backends kommen in M4.
 *
 * Secret-Handling (PLAN §4, Sicherheit): Der API-Key wird bewusst NICHT im
 * Klartext auf die Platte geschrieben (Linux-Plaintext-Falle). In M2 lebt er
 * nur im Speicher des Main-Prozesses für die laufende Sitzung.
 * TODO(M3): Key in den OS-Schlüsselbund verschieben (@napi-rs/keyring), wie es
 *           die Deploy-Credentials tun.
 *
 * Umgebungsneutral (kein node/electron/DOM) — von main, preload und renderer
 * gemeinsam genutzt und headless testbar.
 */

import type { BackendId } from '@webaibuilder/core';

/** In M2 nutzbare Backends. */
export type ActiveBackendId = Extract<BackendId, 'byok' | 'claude-sdk'>;

/** Provider für den `byok`-Adapter (Vercel AI SDK v6). */
export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'xai';

export const ACTIVE_BACKEND_IDS: readonly ActiveBackendId[] = ['byok', 'claude-sdk'];
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
 * Was der Renderer sieht: die secret-freien Daten plus ein Flag, ob aktuell
 * ein Key im Speicher liegt. Der Key selbst wird nie an den Renderer gegeben.
 */
export interface AgentSettings extends AgentSettingsData {
  hasApiKey: boolean;
}

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

/** Modell, das effektiv an `createBackend` geht (Override oder Provider-Default). */
export function effectiveModel(data: AgentSettingsData): string {
  if (data.model.trim() !== '') return data.model.trim();
  if (data.backendId === 'claude-sdk') return DEFAULT_CLAUDE_MODEL;
  return DEFAULT_BYOK_MODEL[data.provider];
}
