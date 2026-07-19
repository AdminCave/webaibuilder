/**
 * Backend-Erkennung für die Abo-/CLI-Adapter (PLAN §4 + §6): „Claude Code
 * gefunden, eingeloggt als …". Zwei Stufen pro CLI:
 *   (a) liegt die Binary auf PATH?  — injizierbares {@link WhichFn}
 *   (b) ist der Nutzer eingeloggt?  — injizierbares {@link ProbeFn} (best-effort,
 *       nie blockierend; der Default-Probe liest nur `--version`)
 *
 * Alles ist injizierbar, damit Detection ohne echte CLIs testbar bleibt und der
 * Desktop reichere Login-Checks (z. B. `codex login status`) nachrüsten kann.
 *
 * Compliance (PLAN §3): Der Default-Probe fasst KEINE Credentials an; er startet
 * höchstens `<binary> --version`. Login-Status bleibt „unbekannt", solange keine
 * seiteneffektfreie Prüfung injiziert wird.
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

/** Statische Metadaten pro CLI-Backend. */
export interface CliMeta {
  id: BackendId;
  /** Binaryname auf PATH. */
  binary: string;
  /** Onboarding-Deeplink (offizielle Vendor-Domain). */
  installHintUrl: string;
  /** Als experimentell markiert (nur grok). */
  experimental?: boolean;
}

/** Registry der vier Abo-/CLI-Backends (Reihenfolge = Anzeigereihenfolge). */
export const CLI_META: readonly CliMeta[] = [
  { id: 'claude-cli', binary: 'claude', installHintUrl: CLAUDE_CLI_INSTALL_URL },
  { id: 'codex', binary: 'codex', installHintUrl: CODEX_INSTALL_URL },
  { id: 'gemini-cli', binary: 'gemini', installHintUrl: GEMINI_CLI_INSTALL_URL },
  { id: 'grok-cli', binary: 'grok', installHintUrl: GROK_CLI_INSTALL_URL, experimental: true },
];

/** Ergebnis eines Login-/Version-Probes (alle Felder best-effort). */
export interface ProbeResult {
  /** Überschreibt „installiert" (Default: true, wenn which erfolgreich war). */
  installed?: boolean;
  /** true/false/undefined (=unbekannt). */
  loggedIn?: boolean;
  version?: string;
  account?: string;
}

/** Löst einen Binaryname zu einem absoluten Pfad auf (oder null). */
export type WhichFn = (binary: string) => Promise<string | null>;

/** Best-effort-Probe eines gefundenen Binaries (nie blockierend, wirft nie). */
export type ProbeFn = (id: BackendId, binaryPath: string) => Promise<ProbeResult>;

/** Optionen für die CLI-Detection (alles injizierbar). */
export interface DetectCliOptions {
  which?: WhichFn;
  probe?: ProbeFn;
  /** spawn für den Default-Probe (`--version`). Default: echtes spawn. */
  spawn?: SpawnFn;
  /** Env für die Default-PATH-Auflösung. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Remote-Kill-Switch (PLAN §3). Default: nie aktiv. */
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

/** Default-`which`: durchsucht `PATH` (best-effort, wirft nie). */
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

/** Ausgabe eines seiteneffektfreien Probe-Kommandos. */
export interface ProbeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Startet `<binary> <args…>` und sammelt stdout/stderr + Exit-Code — best
 * effort, nie blockierend (Timeout → SIGKILL → undefined), wirft nie. Basis für
 * die Versions-Probe und die vendor-spezifischen Login-Proben (loginProbes.ts).
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
        /* schon weg */
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

/** Startet `<binary> --version` und liefert die erste Ausgabezeile (best-effort). */
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
 * Default-Probe: liest nur `--version` (best-effort). Login-Status bleibt
 * „unbekannt" (undefined) — eine seiteneffektfreie Login-Prüfung ist
 * vendor-spezifisch und wird bei Bedarf injiziert (Desktop, PLAN §6).
 */
export function makeDefaultProbe(spawnFn: SpawnFn = defaultSpawn): ProbeFn {
  return async (_id, binaryPath) => {
    const version = await probeVersion(binaryPath, spawnFn);
    return version !== undefined ? { installed: true, version } : { installed: true };
  };
}

/** Erkennt ein einzelnes CLI-Backend (Installations- + best-effort Login-Status). */
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

/** Erkennt alle vier Abo-/CLI-Backends parallel. */
export function detectCliBackends(options: DetectCliOptions = {}): Promise<BackendAvailability[]> {
  return Promise.all(CLI_META.map((meta) => detectCliBackend(meta, options)));
}
