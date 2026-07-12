/**
 * Test-Doubles für die CLI-Engine: ein gefälschter Kindprozess + spawn-Funktion,
 * damit die Abo-/CLI-Adapter OHNE echte Vendor-CLIs getestet werden können.
 *
 * Der Fake puffert Emissionen, die vor dem Anhängen der Listener passieren, und
 * spielt sie beim Anhängen nach — so ist das Timing gegenüber der async-Generator-
 * Iteration deterministisch.
 */

import type { CliChild, CliReadable, CliStdin, SpawnFn } from '../../src/cliEngine';

type DataListener = (chunk: Buffer | string) => void;
type EndListener = () => void;
type ErrorListener = (err: NodeJS.ErrnoException) => void;
type CloseListener = (code: number | null, signal: NodeJS.Signals | null) => void;

/** Gefälschter Kindprozess, den der Test von außen treibt. */
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

  // --- Steuerung durch den Test ---------------------------------------------

  /** Eine rohe stdout-Zeile (inkl. Zeilenumbruch) emittieren. */
  emitStdoutRaw(raw: string): void {
    if (this.#dataListeners.length === 0) {
      this.#pendingData.push(raw);
      return;
    }
    for (const listener of this.#dataListeners) listener(raw);
  }

  /** Eine JSONL-Zeile emittieren (Objekt oder fertiger String). */
  emitLine(line: unknown): void {
    const raw = typeof line === 'string' ? line : JSON.stringify(line);
    this.emitStdoutRaw(`${raw}\n`);
  }

  /** stdout beenden (Rest-Puffer flushen). */
  emitStdoutEnd(): void {
    this.#pendingEnd = true;
    for (const listener of this.#endListeners) listener();
  }

  /** Den Prozess normal/mit Code beenden. */
  emitClose(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emitStdoutEnd();
    if (this.#closeListeners.length === 0) {
      this.#pendingClose = { code, signal };
      return;
    }
    for (const listener of this.#closeListeners) listener(code, signal);
  }

  /** Einen spawn-Fehler emittieren (z. B. ENOENT). */
  emitError(err: NodeJS.ErrnoException): void {
    if (this.#errorListeners.length === 0) {
      this.#pendingError = err;
      return;
    }
    for (const listener of this.#errorListeners) listener(err);
  }
}

/** Ergebnis von {@link controllableSpawn}: Kind + spawn-Funktion + letzte Args. */
export interface Controllable {
  child: FakeChild;
  spawn: SpawnFn;
  /** Nach dem Spawn gesetzt: Kommando, Argumente, cwd, env. */
  calls: Array<{ command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }>;
}

/** spawn-Fake, der einen bereits vorhandenen {@link FakeChild} liefert. */
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
 * spawn-Fake, der einen kompletten Transcript automatisch abspielt: alle Zeilen,
 * dann `close(exitCode)`. Für die einfachen Mapping-Tests.
 */
export function scriptedSpawn(
  lines: readonly unknown[],
  opts: { exitCode?: number; signal?: NodeJS.Signals | null } = {},
): { spawn: SpawnFn; child: FakeChild; calls: Controllable['calls'] } {
  const child = new FakeChild();
  const calls: Controllable['calls'] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    // Nach dem aktuellen Tick emittieren, sobald die Engine ihre Listener hängt.
    queueMicrotask(() => {
      for (const line of lines) child.emitLine(line);
      child.emitClose(opts.exitCode ?? 0, opts.signal ?? null);
    });
    return child;
  };
  return { spawn, child, calls };
}

/** spawn-Fake, der einen ENOENT-Fehler wirft (Binary nicht gefunden). */
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
