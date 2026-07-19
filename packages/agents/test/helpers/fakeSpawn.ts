/**
 * Test doubles for the CLI engine: a fake child process + spawn function, so the
 * subscription/CLI adapters can be tested WITHOUT real vendor CLIs.
 *
 * The fake buffers emissions that happen before listeners are attached and
 * replays them on attach — this keeps the timing deterministic relative to the
 * async-generator iteration.
 */

import type { CliChild, CliReadable, CliStdin, SpawnFn } from '../../src/cliEngine';

type DataListener = (chunk: Buffer | string) => void;
type EndListener = () => void;
type ErrorListener = (err: NodeJS.ErrnoException) => void;
type CloseListener = (code: number | null, signal: NodeJS.Signals | null) => void;

/** Fake child process that the test drives from the outside. */
export class FakeChild implements CliChild {
  readonly stdinChunks: string[] = [];
  readonly killSignals: Array<NodeJS.Signals | number> = [];
  stdinEnded = false;

  #dataListeners: DataListener[] = [];
  #endListeners: EndListener[] = [];
  #errorListeners: ErrorListener[] = [];
  #closeListeners: CloseListener[] = [];

  #pendingData: string[] = [];
  #pendingEnd = false;
  #pendingError: NodeJS.ErrnoException | null = null;
  #pendingClose: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  readonly pid = 4242;

  readonly stdout: CliReadable = {
    on: (event: 'data' | 'end', listener: DataListener | EndListener): unknown => {
      if (event === 'data') {
        this.#dataListeners.push(listener as DataListener);
        const pending = this.#pendingData;
        this.#pendingData = [];
        for (const chunk of pending) (listener as DataListener)(chunk);
      } else {
        this.#endListeners.push(listener as EndListener);
        if (this.#pendingEnd) (listener as EndListener)();
      }
      return this;
    },
  };

  readonly stderr: CliReadable = {
    on: (): unknown => this,
  };

  readonly stdin: CliStdin = {
    write: (chunk: string): unknown => {
      this.stdinChunks.push(chunk);
      return true;
    },
    end: (): unknown => {
      this.stdinEnded = true;
      return undefined;
    },
  };

  on(event: 'error', listener: ErrorListener): unknown;
  on(event: 'close', listener: CloseListener): unknown;
  on(event: 'error' | 'close', listener: ErrorListener | CloseListener): unknown {
    if (event === 'error') {
      this.#errorListeners.push(listener as ErrorListener);
      if (this.#pendingError) (listener as ErrorListener)(this.#pendingError);
    } else {
      this.#closeListeners.push(listener as CloseListener);
      if (this.#pendingClose) (listener as CloseListener)(this.#pendingClose.code, this.#pendingClose.signal);
    }
    return this;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal ?? 'SIGTERM');
    return true;
  }

  // --- Control by the test --------------------------------------------------

  /** Emit a raw stdout line (including the newline). */
  emitStdoutRaw(raw: string): void {
    if (this.#dataListeners.length === 0) {
      this.#pendingData.push(raw);
      return;
    }
    for (const listener of this.#dataListeners) listener(raw);
  }

  /** Emit a JSONL line (object or ready-made string). */
  emitLine(line: unknown): void {
    const raw = typeof line === 'string' ? line : JSON.stringify(line);
    this.emitStdoutRaw(`${raw}\n`);
  }

  /** End stdout (flush the remaining buffer). */
  emitStdoutEnd(): void {
    this.#pendingEnd = true;
    for (const listener of this.#endListeners) listener();
  }

  /** End the process normally / with a code. */
  emitClose(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emitStdoutEnd();
    if (this.#closeListeners.length === 0) {
      this.#pendingClose = { code, signal };
      return;
    }
    for (const listener of this.#closeListeners) listener(code, signal);
  }

  /** Emit a spawn error (e.g. ENOENT). */
  emitError(err: NodeJS.ErrnoException): void {
    if (this.#errorListeners.length === 0) {
      this.#pendingError = err;
      return;
    }
    for (const listener of this.#errorListeners) listener(err);
  }
}

/** Result of {@link controllableSpawn}: child + spawn function + last args. */
export interface Controllable {
  child: FakeChild;
  spawn: SpawnFn;
  /** Set after the spawn: command, arguments, cwd, env. */
  calls: Array<{ command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }>;
}

/** spawn fake that returns an already-existing {@link FakeChild}. */
export function controllableSpawn(): Controllable {
  const child = new FakeChild();
  const calls: Controllable['calls'] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    return child;
  };
  return { child, spawn, calls };
}

/**
 * spawn fake that automatically plays back a complete transcript: all lines,
 * then `close(exitCode)`. For the simple mapping tests.
 */
export function scriptedSpawn(
  lines: readonly unknown[],
  opts: { exitCode?: number; signal?: NodeJS.Signals | null } = {},
): { spawn: SpawnFn; child: FakeChild; calls: Controllable['calls'] } {
  const child = new FakeChild();
  const calls: Controllable['calls'] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    // Emit after the current tick, once the engine attaches its listeners.
    queueMicrotask(() => {
      for (const line of lines) child.emitLine(line);
      child.emitClose(opts.exitCode ?? 0, opts.signal ?? null);
    });
    return child;
  };
  return { spawn, child, calls };
}

/** spawn fake that throws an ENOENT error (binary not found). */
export function enoentSpawn(): { spawn: SpawnFn; child: FakeChild } {
  const child = new FakeChild();
  const spawn: SpawnFn = () => {
    queueMicrotask(() => {
      const err: NodeJS.ErrnoException = new Error('spawn ENOENT');
      err.code = 'ENOENT';
      child.emitError(err);
    });
    return child;
  };
  return { spawn, child };
}
