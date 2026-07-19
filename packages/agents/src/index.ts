/**
 * Agent adapters (PLAN §4): one interface, six backends.
 * Electron-free — this package must never import `electron`.
 *
 * M2: `byok` (Vercel AI SDK v7, workspace-scoped tools) and `claude-sdk`
 *     (@anthropic-ai/claude-agent-sdk, API key).
 * M4: the four subscription/CLI backends — `claude-cli`, `codex`, `gemini-cli`,
 *     `grok-cli` — spawn the OFFICIAL, UNMODIFIED vendor CLI that the user has
 *     installed and logged in to themselves (PLAN §3). Tokens are never touched
 *     and backends are never redirected.
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

// M4: subscription/CLI adapters + shared engine.
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
 * Result of backend detection ("Claude Code found, logged in as …").
 *
 * M4 extends the M2 shape ADDITIVELY (no existing fields changed): new are
 * `loggedIn` (best-effort/unknown), `installHintUrl` (onboarding deep link), and
 * `experimental` (grok).
 */
export interface BackendAvailability {
  id: BackendId;
  /** CLI/SDK present and usable. */
  installed: boolean;
  version?: string;
  /** Logged-in account, if detectable. */
  account?: string;
  /** Disabled via remote kill switch (PLAN §3, compliance). */
  killSwitched: boolean;
  /** Best-effort login status; `undefined` = unknown (not checked). */
  loggedIn?: boolean;
  /** Onboarding deep link to the official vendor installation. */
  installHintUrl?: string;
  /** Experimental backend (grok, PLAN §3 status line xAI). */
  experimental?: boolean;
}

export interface CreateBackendOptions {
  /** API key for `claude-sdk` and `byok`. */
  apiKey?: string;
  /** Path to the user-installed vendor CLI (`claude-cli`, `codex`, `gemini-cli`, `grok-cli`). */
  cliPath?: string;
  /** Model override for `byok`/`claude-sdk`. */
  model?: string;
  /** Provider for `byok` (anthropic | openai | google | xai). Default: anthropic. */
  provider?: ByokProvider;
}

/**
 * Creates the adapter for a backend.
 *
 * M2: `byok` (Vercel AI SDK, workspace-scoped read/write/edit tools) and
 *     `claude-sdk` (@anthropic-ai/claude-agent-sdk, `canUseTool`
 *     → permission-request).
 * M4: `claude-cli`, `codex`, `gemini-cli`, `grok-cli` — each spawns the
 *     official, unmodified vendor CLI and never touches tokens (PLAN §3). The
 *     login lives solely with the CLI; the app only passes `cliPath` (optional).
 */
export function createBackend(id: BackendId, options: CreateBackendOptions): AgentBackend {
  const cliConfig = options.cliPath !== undefined ? { cliPath: options.cliPath } : {};
  switch (id) {
    case 'byok': {
      if (!options.apiKey) {
        throw new Error('"byok" requires an API key.');
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
      throw new Error(`Unknown agent backend "${String(exhaustive)}".`);
    }
  }
}

/** Options for {@link detectBackends} (everything injectable; see {@link DetectCliOptions}). */
export interface DetectBackendsOptions extends DetectCliOptions {
  /** Env for the `claude-sdk` key check. Default: `process.env`. */
  keyEnv?: NodeJS.ProcessEnv;
}

/**
 * Detects installed backends and their login status.
 *
 * `byok` is always available (only needs a key when created); `claude-sdk` is
 * available as soon as `ANTHROPIC_API_KEY` is in the environment. The four
 * subscription/CLI backends are detected via PATH lookup + best-effort login
 * probe (injectable, never blocking, PLAN §4/§6). Kill-switch query via
 * `options.killSwitched` (remote config, PLAN §3).
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
