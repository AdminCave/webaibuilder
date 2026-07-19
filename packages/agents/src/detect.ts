/**
 * Backend detection for the subscription/CLI adapters (PLAN §4 + §6): "Claude
 * Code found, logged in as …". Two stages per CLI:
 *   (a) is the binary on PATH?  — injectable {@link WhichFn}
 *   (b) is the user logged in?  — injectable {@link ProbeFn} (best-effort,
 *       never blocking; the default probe only reads `--version`)
 *
 * Everything is injectable so detection stays testable without real CLIs and the
 * desktop can add richer login checks (e.g. `codex login status`) later.
 *
 * Compliance (PLAN §3): The default probe touches NO credentials; at most it runs
 * `<binary> --version`. Login status stays "unknown" as long as no
 * side-effect-free check is injected.
 */

import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import type { BackendId } from '@webaibuilder/core';

import { CLAUDE_CLI_INSTALL_URL } from './claudeCli';
import { defaultSpawn, type CliChild, type SpawnFn } from './cliEngine';
import { CODEX_INSTALL_URL } from './codex';
import { GEMINI_CLI_INSTALL_URL } from './geminiCli';
import { GROK_CLI_INSTALL_URL } from './grokCli';
import type { BackendAvailability } from './index';

/** Static metadata per CLI backend. */
export interface CliMeta {
  id: BackendId;
  /** Binary name on PATH. */
  binary: string;
  /** Onboarding deep link (official vendor domain). */
  installHintUrl: string;
  /** Marked as experimental (grok only). */
  experimental?: boolean;
}

/** Registry of the four subscription/CLI backends (order = display order). */
export const CLI_META: readonly CliMeta[] = [
  { id: 'claude-cli', binary: 'claude', installHintUrl: CLAUDE_CLI_INSTALL_URL },
  { id: 'codex', binary: 'codex', installHintUrl: CODEX_INSTALL_URL },
  { id: 'gemini-cli', binary: 'gemini', installHintUrl: GEMINI_CLI_INSTALL_URL },
  { id: 'grok-cli', binary: 'grok', installHintUrl: GROK_CLI_INSTALL_URL, experimental: true },
];

/** Result of a login/version probe (all fields best-effort). */
export interface ProbeResult {
  /** Overrides "installed" (default: true when which succeeded). */
  installed?: boolean;
  /** true/false/undefined (=unknown). */
  loggedIn?: boolean;
  version?: string;
  account?: string;
}

/** Resolves a binary name to an absolute path (or null). */
export type WhichFn = (binary: string) => Promise<string | null>;

/** Best-effort probe of a found binary (never blocking, never throws). */
export type ProbeFn = (id: BackendId, binaryPath: string) => Promise<ProbeResult>;

/** Options for CLI detection (everything injectable). */
export interface DetectCliOptions {
  which?: WhichFn;
  probe?: ProbeFn;
  /** spawn for the default probe (`--version`). Default: real spawn. */
  spawn?: SpawnFn;
  /** Env for the default PATH resolution. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Remote kill switch (PLAN §3). Default: never active. */
  killSwitched?: (id: BackendId) => boolean;
}

const IS_WINDOWS = process.platform === 'win32';

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Default `which`: searches `PATH` (best-effort, never throws). */
export function makeDefaultWhich(env: NodeJS.ProcessEnv = process.env): WhichFn {
  return async (binary) => {
    const pathVar = env.PATH ?? env.Path ?? '';
    const dirs = pathVar.split(delimiter).filter((d) => d.length > 0);
    const exts = IS_WINDOWS ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, binary + ext);
        if (await isExecutable(candidate)) return candidate;
      }
    }
    return null;
  };
}

/** Output of a side-effect-free probe command. */
export interface ProbeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Runs `<binary> <args…>` and collects stdout/stderr + exit code — best
 * effort, never blocking (timeout → SIGKILL → undefined), never throws. The
 * foundation for the version probe and the vendor-specific login probes
 * (loginProbes.ts).
 */
export function probeCommand(
  binaryPath: string,
  args: readonly string[],
  spawnFn: SpawnFn = defaultSpawn,
  timeoutMs = 3000,
): Promise<ProbeCommandResult | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value?: ProbeCommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child: CliChild;
    try {
      child = spawnFn(binaryPath, args, { cwd: process.cwd(), env: process.env });
    } catch {
      finish(undefined);
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(undefined);
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ stdout: out, stderr: err, exitCode: code });
    });
  });
}

/** Runs `<binary> --version` and returns the first output line (best-effort). */
async function probeVersion(
  binaryPath: string,
  spawnFn: SpawnFn,
  timeoutMs = 3000,
): Promise<string | undefined> {
  const result = await probeCommand(binaryPath, ['--version'], spawnFn, timeoutMs);
  if (result === undefined) return undefined;
  const line = result.stdout.split('\n')[0]?.trim();
  return line !== undefined && line.length > 0 ? line : undefined;
}

/**
 * Default probe: reads only `--version` (best-effort). Login status stays
 * "unknown" (undefined) — a side-effect-free login check is vendor-specific
 * and is injected when needed (desktop, PLAN §6).
 */
export function makeDefaultProbe(spawnFn: SpawnFn = defaultSpawn): ProbeFn {
  return async (_id, binaryPath) => {
    const version = await probeVersion(binaryPath, spawnFn);
    return version !== undefined ? { installed: true, version } : { installed: true };
  };
}

/** Detects a single CLI backend (installation + best-effort login status). */
export async function detectCliBackend(meta: CliMeta, options: DetectCliOptions = {}): Promise<BackendAvailability> {
  const which = options.which ?? makeDefaultWhich(options.env);
  const probe = options.probe ?? makeDefaultProbe(options.spawn);
  const killSwitched = options.killSwitched?.(meta.id) ?? false;

  let binaryPath: string | null;
  try {
    binaryPath = await which(meta.binary);
  } catch {
    binaryPath = null;
  }

  const availability: BackendAvailability = {
    id: meta.id,
    installed: binaryPath !== null,
    killSwitched,
    installHintUrl: meta.installHintUrl,
    ...(meta.experimental ? { experimental: true } : {}),
  };
  if (binaryPath === null) return availability;

  let result: ProbeResult;
  try {
    result = await probe(meta.id, binaryPath);
  } catch {
    result = {};
  }
  availability.installed = result.installed ?? true;
  if (result.version !== undefined) availability.version = result.version;
  if (result.account !== undefined) availability.account = result.account;
  if (result.loggedIn !== undefined) availability.loggedIn = result.loggedIn;
  return availability;
}

/** Detects all four subscription/CLI backends in parallel. */
export function detectCliBackends(options: DetectCliOptions = {}): Promise<BackendAvailability[]> {
  return Promise.all(CLI_META.map((meta) => detectCliBackend(meta, options)));
}
