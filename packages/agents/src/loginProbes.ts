/**
 * Vendor-specific login probes (PLAN §4/§6): turns the perpetual "found" into
 * an honest "logged in as …" or "not logged in".
 *
 * Compliance (PLAN §3, non-negotiable): Only the OFFICIAL, user-installed CLI is
 * started, with a side-effect-free status command — credential files are never
 * read and tokens are never touched.
 *
 * Fail-safe: an unknown command (older CLI version), a timeout, or unclear
 * output → login status stays "unknown" (omit the field). Better to show "found"
 * than to claim a false login status.
 *
 * Checked commands (as of July 2026):
 *  - `claude auth status`  → JSON with `loggedIn` + `email`
 *  - `codex login status`  → text "Logged in …" (exit 0) / "Not logged in"
 *  - gemini/grok: no stable status command yet → version probe only.
 */

import type { BackendId } from '@webaibuilder/core';

import { defaultSpawn, type SpawnFn } from './cliEngine';
import { makeDefaultProbe, probeCommand, type ProbeFn, type ProbeResult } from './detect';

const LOGIN_PROBE_TIMEOUT_MS = 5000;

/** `claude auth status` returns JSON: `{"loggedIn": true, "email": "…", …}`. */
async function probeClaudeLogin(
  binaryPath: string,
  spawnFn: SpawnFn,
): Promise<Partial<ProbeResult>> {
  const result = await probeCommand(
    binaryPath,
    ['auth', 'status'],
    spawnFn,
    LOGIN_PROBE_TIMEOUT_MS,
  );
  if (result === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    return {}; // older CLI without JSON status → unknown (fail-safe)
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const obj = parsed as Record<string, unknown>;
  if (obj['loggedIn'] === true) {
    const email = obj['email'];
    return {
      loggedIn: true,
      ...(typeof email === 'string' && email !== '' ? { account: email } : {}),
    };
  }
  if (obj['loggedIn'] === false) return { loggedIn: false };
  return {};
}

/** `codex login status`: exit 0 + "Logged in …" or "Not logged in". */
async function probeCodexLogin(
  binaryPath: string,
  spawnFn: SpawnFn,
): Promise<Partial<ProbeResult>> {
  const result = await probeCommand(
    binaryPath,
    ['login', 'status'],
    spawnFn,
    LOGIN_PROBE_TIMEOUT_MS,
  );
  if (result === undefined) return {};
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  // Order matters: "not logged in" contains "logged in".
  if (text.includes('not logged in')) return { loggedIn: false };
  if (result.exitCode === 0 && text.includes('logged in')) return { loggedIn: true };
  return {};
}

function loginFor(
  id: BackendId,
  binaryPath: string,
  spawnFn: SpawnFn,
): Promise<Partial<ProbeResult>> {
  switch (id) {
    case 'claude-cli':
      return probeClaudeLogin(binaryPath, spawnFn);
    case 'codex':
      return probeCodexLogin(binaryPath, spawnFn);
    default:
      // gemini-cli/grok-cli: no reliable status command known →
      // login stays "unknown" (version probe only).
      return Promise.resolve({});
  }
}

/**
 * Probe for {@link detectCliBackends}: version probe (like the default) plus
 * vendor-specific login status. Injected in the desktop main process (ipc.ts).
 */
export function makeLoginProbe(spawnFn: SpawnFn = defaultSpawn): ProbeFn {
  const base = makeDefaultProbe(spawnFn);
  return async (id, binaryPath) => {
    const version = await base(id, binaryPath);
    const login = await loginFor(id, binaryPath, spawnFn);
    return { ...version, ...login };
  };
}
