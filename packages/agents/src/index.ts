/**
 * Agent-Adapter (PLAN §4): ein Interface, sechs Backends.
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
 */

import type { AgentBackend, BackendId } from '@webaibuilder/core';

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
  /** Modell-Override für `byok`. */
  model?: string;
}

/**
 * Erzeugt den Adapter für ein Backend.
 *
 * TODO(M2): `byok` (Vercel AI SDK v6, workspace-scoped read/write/edit-Tools)
 *           und `claude-sdk` (@anthropic-ai/claude-agent-sdk, `canUseTool`
 *           → permission-request).
 * TODO(M4): `claude-cli` (System-`claude -p --output-format stream-json`,
 *           Feature-Flag), `codex` (@openai/codex-sdk), `gemini-cli`,
 *           `grok-cli` — immer die offizielle, unveränderte Vendor-CLI
 *           spawnen, nie Tokens anfassen (PLAN §3).
 */
export function createBackend(id: BackendId, _options: CreateBackendOptions): AgentBackend {
  throw new Error(`Agent-Backend "${id}" ist noch nicht implementiert (kommt in M2/M4).`);
}

/**
 * Erkennt installierte Backends und deren Login-Status.
 *
 * TODO(M4): CLI-Detection + Kill-Switch-Abfrage (Remote-Config, PLAN §3).
 */
export function detectBackends(): Promise<BackendAvailability[]> {
  return Promise.resolve([]);
}
