/**
 * Vendor-spezifische Login-Proben (PLAN §4/§6): macht aus dem ewigen „gefunden"
 * ein ehrliches „eingeloggt als …" bzw. „nicht eingeloggt".
 *
 * Compliance (PLAN §3, nicht verhandelbar): Es wird ausschließlich die
 * OFFIZIELLE, vom Nutzer installierte CLI mit einem seiteneffektfreien
 * Status-Kommando gestartet — niemals werden Credential-Dateien gelesen oder
 * Tokens angefasst.
 *
 * Fail-safe: unbekanntes Kommando (ältere CLI-Version), Timeout oder unklare
 * Ausgabe → Login-Status bleibt „unbekannt" (Feld weglassen). Lieber „gefunden"
 * anzeigen als einen falschen Login-Status behaupten.
 *
 * Geprüfte Kommandos (Stand Juli 2026):
 *  - `claude auth status`  → JSON mit `loggedIn` + `email`
 *  - `codex login status`  → Text „Logged in …" (Exit 0) / „Not logged in"
 *  - gemini/grok: noch kein stabiles Status-Kommando → nur Versions-Probe.
 */

import type { BackendId } from '@webaibuilder/core';

import { defaultSpawn, type SpawnFn } from './cliEngine';
import { makeDefaultProbe, probeCommand, type ProbeFn, type ProbeResult } from './detect';

const LOGIN_PROBE_TIMEOUT_MS = 5000;

/** `claude auth status` liefert JSON: `{"loggedIn": true, "email": "…", …}`. */
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
    return {}; // ältere CLI ohne JSON-Status → unbekannt (fail-safe)
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

/** `codex login status`: Exit 0 + „Logged in …" bzw. „Not logged in". */
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
  // Reihenfolge wichtig: „not logged in" enthält „logged in".
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
      // gemini-cli/grok-cli: kein verlässliches Status-Kommando bekannt →
      // Login bleibt „unbekannt" (nur Versions-Probe).
      return Promise.resolve({});
  }
}

/**
 * Probe für {@link detectCliBackends}: Versions-Probe (wie der Default) plus
 * vendor-spezifischem Login-Status. Wird im Desktop-Main injiziert (ipc.ts).
 */
export function makeLoginProbe(spawnFn: SpawnFn = defaultSpawn): ProbeFn {
  const base = makeDefaultProbe(spawnFn);
  return async (id, binaryPath) => {
    const version = await base(id, binaryPath);
    const login = await loginFor(id, binaryPath, spawnFn);
    return { ...version, ...login };
  };
}
