/**
 * Shared machinery for the four subscription/CLI adapters (PLAN §4, M4):
 * `claude-cli` · `codex` · `gemini-cli` · `grok-cli`.
 *
 * Each adapter spawns the OFFICIAL, UNMODIFIED vendor CLI that the user has
 * installed and logged in to themselves (PLAN §3, non-negotiable):
 *   - The app NEVER reads/stores/proxies/transmits OAuth tokens.
 *   - No `ANTHROPIC_BASE_URL`/backend redirect, no harness spoofing.
 *   - The app passes NO credentials through — the CLI uses its own login.
 *     The env is passed through verbatim (no token/base-url injection).
 *
 * The process stdout is JSONL (one JSON object per line). This engine reads
 * line by line, tolerantly skips broken lines, and maps each line via a
 * vendor-specific {@link CliSpec} onto the core `AgentEvent` stream. The
 * permission back-channel runs over the `yield` return value (see `runTurn`).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type {
  AgentBackend,
  AgentCapabilities,
  AgentErrorEvent,
  AgentEvent,
  AgentTurnRequest,
  BackendId,
  PermissionDecision,
  PermissionRequestEvent,
  TurnStopReason,
} from '@webaibuilder/core';

import { AsyncQueue } from './asyncQueue';

/** Minimal stdin writer (subset of `Writable`). */
export interface CliStdin {
  write(chunk: string): unknown;
  end(): unknown;
}

/** Minimal readable stream (subset of `Readable`). */
export interface CliReadable {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/** Minimal child-process interface the engine uses (testable). */
export interface CliChild {
  readonly stdout: CliReadable | null;
  readonly stderr: CliReadable | null;
  readonly stdin: CliStdin | null;
  readonly pid?: number | undefined;
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** Injectable spawn function (default: real `child_process.spawn`). */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => CliChild;

/** Default spawn: a real, un-piped vendor-CLI child. */
export const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, args as string[], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as unknown as CliChild;

/** Construction data for a CLI adapter. */
export interface CliBackendConfig {
  /** Path/name of the vendor binary. Default: `spec.binary` (PATH resolution). */
  cliPath?: string;
  /** Injectable spawn function — for tests. Default: {@link defaultSpawn}. */
  spawn?: SpawnFn;
  /** Grace period (ms) between SIGTERM and SIGKILL on `interrupt()`. Default 2000. */
  killGraceMs?: number;
  /**
   * Env passed through to the CLI. Default: `process.env` (unchanged).
   * IMPORTANT (PLAN §3): NEVER set `ANTHROPIC_BASE_URL` or similar, or tokens, here.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Watchdog: while the CLI produces no output at all (stdout/stderr) and is
   * not waiting for a permission answer, the turn is aborted with an error and
   * the process is terminated — otherwise the UI would hang forever on protocol
   * drift (e.g. a missing result event) in "The AI is working …".
   * 0 = off. Default 120,000 ms.
   */
  idleTimeoutMs?: number;
}

/** What the engine carries along for a running turn; mutable by `mapLine`. */
export interface TurnState {
  /** Docroot of the turn (`<workspaceDir>/site`). */
  readonly siteDir: string;
  /** Session ID for resuming (if the backend supports `resume`). */
  sessionId: string | undefined;
  /** Cost in USD, if the CLI reports it. */
  costUsd: number | undefined;
  /** Stop reason; default `end`, settable to `error` by `mapLine`. */
  stopReason: TurnStopReason;
  /** Signals to the engine that the turn is logically done (close stdin). */
  done: boolean;
  /** Display names of open tool calls (toolCallId → label). */
  readonly tools: Map<string, string>;
}

/** Invocation description that a {@link CliSpec} provides per turn. */
export interface CliInvocation {
  /** Arguments (without the binary itself). */
  args: string[];
  /** JSON objects written to stdin before reading begins (e.g. the prompt). */
  stdinInit?: unknown[];
  /**
   * Keep stdin open (claude-cli needs this for `control_response` replies).
   * Default: false → stdin is closed immediately after `stdinInit`.
   */
  keepStdinOpen?: boolean;
}

/** Vendor-specific contract; the engine is otherwise backend-agnostic. */
export interface CliSpec {
  readonly id: BackendId;
  /** Default binary name (on PATH), e.g. "claude". */
  readonly binary: string;
  capabilities(): AgentCapabilities;
  /** Error event when the binary was not found (ENOENT) — with an install hint. */
  notFound(): AgentErrorEvent;
  /** Builds arguments + stdin for a turn. */
  buildInvocation(req: AgentTurnRequest): CliInvocation;
  /** Maps a parsed JSONL line onto 0..n AgentEvents; may mutate `state`. */
  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[];
  /**
   * Builds the stdin reply to a permission-request (e.g. claude
   * `control_response`). `null` = write nothing. Fail-safe deny when
   * `decision` is undefined/`allow:false`.
   */
  answerPermission?(event: PermissionRequestEvent, decision: PermissionDecision | undefined): unknown | null;
}

type EngineItem =
  | { kind: 'json'; value: Record<string, unknown> }
  | { kind: 'spawn-error'; error: NodeJS.ErrnoException }
  | { kind: 'idle-timeout' }
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null };

const DEFAULT_KILL_GRACE_MS = 2000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

class CliBackend implements AgentBackend {
  readonly id: BackendId;
  readonly #spec: CliSpec;
  readonly #spawn: SpawnFn;
  readonly #command: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #killGraceMs: number;
  readonly #idleTimeoutMs: number;

  #child: CliChild | null = null;
  #exited = false;
  #interrupted = false;
  #killTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(spec: CliSpec, config: CliBackendConfig) {
    this.#spec = spec;
    this.id = spec.id;
    this.#spawn = config.spawn ?? defaultSpawn;
    this.#command = config.cliPath ?? spec.binary;
    // Pass the env through unchanged (PLAN §3: no base-url/token injection).
    this.#env = config.env ?? process.env;
    this.#killGraceMs = config.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.#idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  capabilities(): AgentCapabilities {
    return this.#spec.capabilities();
  }

  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const turnId = randomUUID();
    const state: TurnState = {
      siteDir: req.siteDir,
      sessionId: req.sessionId,
      costUsd: undefined,
      stopReason: 'end',
      done: false,
      tools: new Map(),
    };

    const inv = this.#spec.buildInvocation(req);
    const queue = new AsyncQueue<EngineItem>();

    // Reset the interrupt/exit state for this turn.
    this.#exited = false;
    this.#interrupted = false;
    this.#killTimer = null;

    let child: CliChild;
    try {
      child = this.#spawn(this.#command, inv.args, { cwd: req.siteDir, env: this.#env });
    } catch (err) {
      // Synchronous spawn error (rare) — treat like ENOENT.
      const e = err as NodeJS.ErrnoException;
      yield e.code === 'ENOENT'
        ? this.#spec.notFound()
        : { type: 'error', message: 'The CLI could not be started.', recoverable: false, cause: e.message };
      yield { type: 'turn-complete', turnId, stopReason: 'error', sessionId: state.sessionId, costUsd: state.costUsd };
      return;
    }
    this.#child = child;

    // --- Watchdog: re-armed on every stdout/stderr CHUNK (a real sign of
    // life), paused while a permission request is open (the user may take as
    // long as they like — the CLI is legitimately silent then).
    let watchdogPaused = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const stopWatchdog = (): void => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const armWatchdog = (): void => {
      if (this.#idleTimeoutMs <= 0 || watchdogPaused) return;
      stopWatchdog();
      // push after queue.close() is a no-op — a late-firing timer cannot
      // disturb a finished turn.
      idleTimer = setTimeout(() => queue.push({ kind: 'idle-timeout' }), this.#idleTimeoutMs);
      idleTimer.unref?.();
    };

    // --- Buffer stdout line by line → parse JSONL (skip broken lines) ---
    let buffer = '';
    const pushLine = (raw: string): void => {
      const line = raw.trim();
      if (line.length === 0) return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return; // tolerantly skip a broken/partial line
      }
      if (value !== null && typeof value === 'object') {
        queue.push({ kind: 'json', value: value as Record<string, unknown> });
      }
    };
    child.stdout?.on('data', (chunk) => {
      armWatchdog();
      buffer += chunk.toString();
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        pushLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    });
    child.stdout?.on('end', () => {
      if (buffer.length > 0) {
        pushLine(buffer);
        buffer = '';
      }
    });

    let stderrTail = '';
    child.stderr?.on('data', (chunk) => {
      armWatchdog();
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    // Enqueue the spawn error (ENOENT) and process exit exactly once.
    let settled = false;
    const settle = (item: EngineItem): void => {
      if (settled) return;
      settled = true;
      queue.push(item);
      queue.close();
    };
    child.on('error', (err) => settle({ kind: 'spawn-error', error: err }));
    child.on('close', (code, signal) => {
      this.#exited = true;
      stopWatchdog();
      if (this.#killTimer) {
        clearTimeout(this.#killTimer);
        this.#killTimer = null;
      }
      settle({ kind: 'exit', code, signal });
    });

    // --- Write prompt/init to stdin ---
    if (inv.stdinInit) {
      for (const obj of inv.stdinInit) child.stdin?.write(`${JSON.stringify(obj)}\n`);
    }
    if (!inv.keepStdinOpen) {
      try {
        child.stdin?.end();
      } catch {
        /* stdin may already be closed */
      }
    }

    // Arm initially — also catches a CLI that never outputs anything.
    armWatchdog();

    try {
      for await (const item of queue) {
        if (item.kind === 'idle-timeout') {
          state.stopReason = 'error';
          // Terminate the process first (BEFORE the yield — otherwise the
          // consumer could drop the stream and the CLI would keep running); the
          // close event then closes the queue.
          this.#terminate();
          const seconds = Math.round(this.#idleTimeoutMs / 1000);
          yield {
            type: 'error',
            message: `The CLI has not responded for ${seconds} seconds and was terminated.`,
            recoverable: true,
          };
          continue;
        }
        if (item.kind === 'spawn-error') {
          state.stopReason = 'error';
          yield item.error.code === 'ENOENT'
            ? this.#spec.notFound()
            : {
                type: 'error',
                message: 'The CLI could not be started.',
                recoverable: false,
                cause: item.error.message,
              };
          continue;
        }
        if (item.kind === 'exit') {
          if (this.#interrupted) {
            state.stopReason = 'interrupted';
          } else if ((item.code ?? 0) !== 0 && state.stopReason !== 'error') {
            state.stopReason = 'error';
            const tail = stderrTail.trim();
            yield {
              type: 'error',
              message: `The CLI exited with code ${item.code ?? '?'}.`,
              recoverable: true,
              ...(tail.length > 0 ? { cause: tail } : {}),
            };
          }
          continue;
        }

        // item.kind === 'json'
        const events = this.#spec.mapLine(item.value, state);
        for (const event of events) {
          // While a permission answer is pending, the watchdog is paused.
          if (event.type === 'permission-request') {
            watchdogPaused = true;
            stopWatchdog();
          }
          // The yield return value is the user's decision (the desktop drives
          // with `next(decision)`); undefined for non-permission events.
          const decision = yield event;
          if (event.type === 'permission-request') {
            if (this.#spec.answerPermission) {
              const response = this.#spec.answerPermission(
                event,
                decision as PermissionDecision | undefined,
              );
              if (response != null) {
                try {
                  child.stdin?.write(`${JSON.stringify(response)}\n`);
                } catch {
                  /* stdin may already be closed — decision undeliverable */
                }
              }
            }
            watchdogPaused = false;
            armWatchdog();
          }
        }

        // Logical end of turn reached → close stdin so the CLI terminates.
        if (state.done && inv.keepStdinOpen) {
          try {
            child.stdin?.end();
          } catch {
            /* already closed */
          }
        }
      }
    } finally {
      this.#child = null;
      stopWatchdog();
      if (this.#killTimer) {
        clearTimeout(this.#killTimer);
        this.#killTimer = null;
      }
    }

    yield {
      type: 'turn-complete',
      turnId,
      stopReason: state.stopReason,
      sessionId: state.sessionId,
      costUsd: state.costUsd,
    };
  }

  interrupt(): Promise<void> {
    this.#interrupted = true;
    this.#terminate();
    return Promise.resolve();
  }

  /** First gracefully (SIGTERM), then after the grace period forcibly (SIGKILL) — used by `interrupt()` and the watchdog. */
  #terminate(): void {
    const child = this.#child;
    if (child === null || this.#exited) return;
    try {
      child.kill('SIGTERM');
    } catch {
      /* process may already be gone */
    }
    const timer = setTimeout(() => {
      if (!this.#exited) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }, this.#killGraceMs);
    timer.unref?.();
    this.#killTimer = timer;
  }
}

/** Creates a CLI adapter from a vendor-specific {@link CliSpec}. */
export function createCliBackend(spec: CliSpec, config: CliBackendConfig = {}): AgentBackend {
  return new CliBackend(spec, config);
}
