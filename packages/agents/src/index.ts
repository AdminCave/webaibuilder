/**
 * Agent-Adapter (PLAN §4): ein Interface, sechs Backends.
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
 *
 * M2: `byok` (Vercel AI SDK v7, workspace-scoped Tools) und `claude-sdk`
 *     (@anthropic-ai/claude-agent-sdk, API-Key).
 * M4: die vier Abo-/CLI-Backends — `claude-cli`, `codex`, `gemini-cli`,
 *     `grok-cli` — spawnen die OFFIZIELLE, UNVERÄNDERTE Vendor-CLI, die der
 *     Nutzer selbst installiert und eingeloggt hat (PLAN §3). Es werden nie
 *     Tokens angefasst oder Backends umgeleitet.
 */

import type { AgentBackend, BackendId } from '@webaibuilder/core';

import { createByokBackend } from './byok';
import { createClaudeCliBackend } from './claudeCli';
import { createClaudeSdkBackend } from './claudeSdk';
import { createCodexBackend } from './codex';
import { detectCliBackends, type DetectCliOptions } from './detect';
import { createGeminiCliBackend } from './geminiCli';
import { createGrokCliBackend } from './grokCli';
import type { ByokProvider } from './providers';

export { createByokBackend, type ByokConfig } from './byok';
export { createClaudeSdkBackend, type ClaudeSdkConfig } from './claudeSdk';
export { DEFAULT_MODELS, resolveModel, type ByokProvider } from './providers';
export { createSiteTools, type SiteTools } from './tools';
export { PathEscapeError, resolveInSite } from './paths';

// M4: Abo-/CLI-Adapter + gemeinsame Engine.
export {
  createCliBackend,
  defaultSpawn,
  type CliBackendConfig,
  type CliChild,
  type CliInvocation,
  type CliReadable,
  type CliSpec,
  type CliStdin,
  type SpawnFn,
  type TurnState,
} from './cliEngine';
export { createClaudeCliBackend, CLAUDE_CLI_INSTALL_URL } from './claudeCli';
export { createCodexBackend, CODEX_INSTALL_URL } from './codex';
export { createGeminiCliBackend, GEMINI_CLI_INSTALL_URL } from './geminiCli';
export { createGrokCliBackend, GROK_CLI_INSTALL_URL } from './grokCli';
export {
  CLI_META,
  detectCliBackend,
  detectCliBackends,
  makeDefaultProbe,
  makeDefaultWhich,
  probeCommand,
  type CliMeta,
  type DetectCliOptions,
  type ProbeCommandResult,
  type ProbeFn,
  type ProbeResult,
  type WhichFn,
} from './detect';
export { makeLoginProbe } from './loginProbes';

/**
 * Ergebnis der Backend-Erkennung ("Claude Code gefunden, eingeloggt als …").
 *
 * M4 erweitert die M2-Form ADDITIV (keine bestehenden Felder geändert): neu sind
 * `loggedIn` (best-effort/unbekannt), `installHintUrl` (Onboarding-Deeplink) und
 * `experimental` (grok).
 */
export interface BackendAvailability {
  id: BackendId;
  /** CLI/SDK vorhanden und nutzbar. */
  installed: boolean;
  version?: string;
  /** Eingeloggtes Konto, falls erkennbar. */
  account?: string;
  /** Per Remote-Kill-Switch deaktiviert (PLAN §3, Compliance). */
  killSwitched: boolean;
  /** Best-effort Login-Status; `undefined` = unbekannt (nicht geprüft). */
  loggedIn?: boolean;
  /** Onboarding-Deeplink zur offiziellen Vendor-Installation. */
  installHintUrl?: string;
  /** Experimentelles Backend (grok, PLAN §3-Statuszeile xAI). */
  experimental?: boolean;
}

export interface CreateBackendOptions {
  /** API-Key für `claude-sdk` und `byok`. */
  apiKey?: string;
  /** Pfad zur nutzer-installierten Vendor-CLI (`claude-cli`, `codex`, `gemini-cli`, `grok-cli`). */
  cliPath?: string;
  /** Modell-Override für `byok`/`claude-sdk`. */
  model?: string;
  /** Anbieter für `byok` (anthropic | openai | google | xai). Default: anthropic. */
  provider?: ByokProvider;
}

/**
 * Erzeugt den Adapter für ein Backend.
 *
 * M2: `byok` (Vercel AI SDK, workspace-scoped read/write/edit-Tools) und
 *     `claude-sdk` (@anthropic-ai/claude-agent-sdk, `canUseTool`
 *     → permission-request).
 * M4: `claude-cli`, `codex`, `gemini-cli`, `grok-cli` — jeweils die offizielle,
 *     unveränderte Vendor-CLI spawnen, nie Tokens anfassen (PLAN §3). Der Login
 *     liegt allein bei der CLI; die App reicht nur `cliPath` (optional) durch.
 */
export function createBackend(id: BackendId, options: CreateBackendOptions): AgentBackend {
  const cliConfig = options.cliPath !== undefined ? { cliPath: options.cliPath } : {};
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
      return createClaudeCliBackend(cliConfig);
    case 'codex':
      return createCodexBackend(cliConfig);
    case 'gemini-cli':
      return createGeminiCliBackend(cliConfig);
    case 'grok-cli':
      return createGrokCliBackend(cliConfig);
    default: {
      const exhaustive: never = id;
      throw new Error(`Unbekanntes Agent-Backend "${String(exhaustive)}".`);
    }
  }
}

/** Optionen für {@link detectBackends} (alles injizierbar; siehe {@link DetectCliOptions}). */
export interface DetectBackendsOptions extends DetectCliOptions {
  /** Env für die `claude-sdk`-Schlüsselprüfung. Default: `process.env`. */
  keyEnv?: NodeJS.ProcessEnv;
}

/**
 * Erkennt installierte Backends und deren Login-Status.
 *
 * `byok` ist immer verfügbar (braucht nur einen Key beim Erzeugen); `claude-sdk`
 * ist verfügbar, sobald `ANTHROPIC_API_KEY` in der Umgebung liegt. Die vier
 * Abo-/CLI-Backends werden per PATH-Lookup + best-effort Login-Probe erkannt
 * (injizierbar, nie blockierend, PLAN §4/§6). Kill-Switch-Abfrage via
 * `options.killSwitched` (Remote-Config, PLAN §3).
 */
export async function detectBackends(options: DetectBackendsOptions = {}): Promise<BackendAvailability[]> {
  const keyEnv = options.keyEnv ?? process.env;
  const hasAnthropicKey = Boolean(keyEnv.ANTHROPIC_API_KEY);
  const cliBackends = await detectCliBackends(options);
  return [
    { id: 'byok', installed: true, killSwitched: false },
    { id: 'claude-sdk', installed: hasAnthropicKey, killSwitched: false },
    ...cliBackends,
  ];
}
