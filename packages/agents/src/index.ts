/**
 * Agent-Adapter (PLAN §4): ein Interface, sechs Backends.
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
 *
 * M2 implementiert: `byok` (Vercel AI SDK v7, workspace-scoped Tools) und
 * `claude-sdk` (@anthropic-ai/claude-agent-sdk, API-Key). Die vier CLI-/Abo-
 * Backends folgen in M4 (offizielle, unveränderte Vendor-CLIs, PLAN §3).
 */

import type { AgentBackend, BackendId } from '@webaibuilder/core';

import { createByokBackend } from './byok';
import { createClaudeSdkBackend } from './claudeSdk';
import type { ByokProvider } from './providers';

export { createByokBackend, type ByokConfig } from './byok';
export { createClaudeSdkBackend, type ClaudeSdkConfig } from './claudeSdk';
export { DEFAULT_MODELS, resolveModel, type ByokProvider } from './providers';
export { createSiteTools, type SiteTools } from './tools';
export { PathEscapeError, resolveInSite } from './paths';

/** Ergebnis der Backend-Erkennung ("Claude Code gefunden, eingeloggt als …"). */
export interface BackendAvailability {
  id: BackendId;
  /** CLI/SDK vorhanden und nutzbar. */
  installed: boolean;
  version?: string;
  /** Eingeloggtes Konto, falls erkennbar. */
  account?: string;
  /** Per Remote-Kill-Switch deaktiviert (PLAN §3, Compliance). */
  killSwitched: boolean;
}

export interface CreateBackendOptions {
  /** API-Key für `claude-sdk` und `byok`. */
  apiKey?: string;
  /** Pfad zur nutzer-installierten Vendor-CLI (`claude-cli`, `gemini-cli`, `grok-cli`). */
  cliPath?: string;
  /** Modell-Override für `byok`/`claude-sdk`. */
  model?: string;
  /** Anbieter für `byok` (anthropic | openai | google | xai). Default: anthropic. */
  provider?: ByokProvider;
}

const M4_BACKENDS: readonly BackendId[] = ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'];

/**
 * Erzeugt den Adapter für ein Backend.
 *
 * M2: `byok` (Vercel AI SDK, workspace-scoped read/write/edit-Tools) und
 *     `claude-sdk` (@anthropic-ai/claude-agent-sdk, `canUseTool`
 *     → permission-request).
 * M4: `claude-cli` (System-`claude -p --output-format stream-json`,
 *     Feature-Flag), `codex` (@openai/codex-sdk), `gemini-cli`, `grok-cli`
 *     — immer die offizielle, unveränderte Vendor-CLI spawnen, nie Tokens
 *     anfassen (PLAN §3).
 */
export function createBackend(id: BackendId, options: CreateBackendOptions): AgentBackend {
  switch (id) {
    case 'byok': {
      if (!options.apiKey) {
        throw new Error('Für "byok" brauchst du einen API-Key.');
      }
      return createByokBackend({
        provider: options.provider ?? 'anthropic',
        apiKey: options.apiKey,
        model: options.model,
      });
    }
    case 'claude-sdk':
      return createClaudeSdkBackend({ apiKey: options.apiKey, model: options.model });
    case 'claude-cli':
    case 'codex':
    case 'gemini-cli':
    case 'grok-cli':
      throw new Error(
        `Agent-Backend "${id}" kommt in M4 — nutze vorerst "byok" (API-Key) oder "claude-sdk".`,
      );
    default: {
      const exhaustive: never = id;
      throw new Error(`Unbekanntes Agent-Backend "${String(exhaustive)}".`);
    }
  }
}

/**
 * Erkennt installierte Backends und deren Login-Status.
 *
 * M2: `byok` ist immer verfügbar (braucht nur einen Key beim Erzeugen);
 *     `claude-sdk` ist verfügbar, sobald `ANTHROPIC_API_KEY` in der Umgebung
 *     liegt (oder beim Erzeugen ein Key übergeben wird).
 * M4: CLI-Detection + Kill-Switch-Abfrage (Remote-Config, PLAN §3).
 */
export function detectBackends(): Promise<BackendAvailability[]> {
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const result: BackendAvailability[] = [
    { id: 'byok', installed: true, killSwitched: false },
    { id: 'claude-sdk', installed: hasAnthropicKey, killSwitched: false },
    ...M4_BACKENDS.map((id) => ({ id, installed: false, killSwitched: false })),
  ];
  return Promise.resolve(result);
}
