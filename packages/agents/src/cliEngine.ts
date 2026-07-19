/**
 * Gemeinsame Maschinerie für die vier Abo-/CLI-Adapter (PLAN §4, M4):
 * `claude-cli` · `codex` · `gemini-cli` · `grok-cli`.
 *
 * Jeder Adapter spawnt die OFFIZIELLE, UNVERÄNDERTE Vendor-CLI, die der Nutzer
 * selbst installiert und selbst eingeloggt hat (PLAN §3, nicht verhandelbar):
 *   - Die App liest/speichert/proxied/überträgt NIEMALS OAuth-Tokens.
 *   - Kein `ANTHROPIC_BASE_URL`/Backend-Umleiten, kein Harness-Spoofing.
 *   - Die App reicht KEINE Credentials weiter — die CLI nutzt ihren eigenen
 *     Login. Das Env wird 1:1 durchgereicht (keine token-/base-url-Injektion).
 *
 * Der Prozess-Stdout ist JSONL (ein JSON-Objekt pro Zeile). Diese Engine liest
 * zeilenweise, überspringt kaputte Zeilen tolerant und mappt jede Zeile per
 * vendor-spezifischem {@link CliSpec} auf den core-`AgentEvent`-Strom. Der
 * Permission-Rückkanal läuft über den `yield`-Rückgabewert (siehe `runTurn`).
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

/** Minimaler stdin-Writer (Teilmenge von `Writable`). */
export interface CliStdin {
  write(chunk: string): unknown;
  end(): unknown;
}

/** Minimaler lesbarer Stream (Teilmenge von `Readable`). */
export interface CliReadable {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/** Minimale Kindprozess-Schnittstelle, die die Engine nutzt (testbar). */
export interface CliChild {
  readonly stdout: CliReadable | null;
  readonly stderr: CliReadable | null;
  readonly stdin: CliStdin | null;
  readonly pid?: number | undefined;
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** Injizierbare spawn-Funktion (Default: echtes `child_process.spawn`). */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => CliChild;

/** Default-spawn: echtes, ungepipetes Vendor-CLI-Kind. */
export const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, args as string[], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as unknown as CliChild;

/** Konstruktionsdaten für einen CLI-Adapter. */
export interface CliBackendConfig {
  /** Pfad/Name der Vendor-Binary. Default: `spec.binary` (PATH-Auflösung). */
  cliPath?: string;
  /** Injizierbare spawn-Funktion — für Tests. Default: {@link defaultSpawn}. */
  spawn?: SpawnFn;
  /** Grace-Zeit (ms) zwischen SIGTERM und SIGKILL bei `interrupt()`. Default 2000. */
  killGraceMs?: number;
  /**
   * Env, das an die CLI durchgereicht wird. Default: `process.env` (unverändert).
   * WICHTIG (PLAN §3): hier NIEMALS `ANTHROPIC_BASE_URL` o. Ä. oder Tokens setzen.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Watchdog: liefert die CLI so lange keinerlei Ausgabe (stdout/stderr) und
   * wartet dabei nicht auf eine Permission-Antwort, wird der Turn mit Fehler
   * abgebrochen und der Prozess beendet — sonst hinge die UI bei Protokoll-
   * Drift (z. B. fehlendes result-Event) ewig in „Die KI arbeitet …".
   * 0 = aus. Default 120 000 ms.
   */
  idleTimeoutMs?: number;
}

/** Was die Engine über einen laufenden Turn mitführt; von `mapLine` mutierbar. */
export interface TurnState {
  /** Docroot des Turns (`<workspaceDir>/site`). */
  readonly siteDir: string;
  /** Session-ID zum Fortsetzen (falls das Backend `resume` kann). */
  sessionId: string | undefined;
  /** Kosten in USD, falls die CLI sie meldet. */
  costUsd: number | undefined;
  /** Abschlussgrund; Default `end`, von `mapLine` auf `error` setzbar. */
  stopReason: TurnStopReason;
  /** Signalisiert der Engine, dass der Turn logisch fertig ist (stdin schließen). */
  done: boolean;
  /** Anzeige-Namen offener Tool-Calls (toolCallId → Label). */
  readonly tools: Map<string, string>;
}

/** Aufruf-Beschreibung, die ein {@link CliSpec} pro Turn liefert. */
export interface CliInvocation {
  /** Argumente (ohne die Binary selbst). */
  args: string[];
  /** JSON-Objekte, die vor dem Lesen auf stdin geschrieben werden (z. B. Prompt). */
  stdinInit?: unknown[];
  /**
   * stdin offen halten (claude-cli braucht das für `control_response`-Antworten).
   * Default: false → stdin wird nach `stdinInit` sofort geschlossen.
   */
  keepStdinOpen?: boolean;
}

/** Vendor-spezifischer Vertrag; die Engine ist ansonsten backend-agnostisch. */
export interface CliSpec {
  readonly id: BackendId;
  /** Default-Binaryname (auf PATH), z. B. "claude". */
  readonly binary: string;
  capabilities(): AgentCapabilities;
  /** Fehler-Event, wenn die Binary nicht gefunden wurde (ENOENT) — mit Install-Hinweis. */
  notFound(): AgentErrorEvent;
  /** Baut Argumente + stdin für einen Turn. */
  buildInvocation(req: AgentTurnRequest): CliInvocation;
  /** Mappt eine geparste JSONL-Zeile auf 0..n AgentEvents; darf `state` mutieren. */
  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[];
  /**
   * Baut die stdin-Antwort auf ein permission-request (z. B. claude
   * `control_response`). `null` = nichts schreiben. Fail-safe deny, wenn
   * `decision` undefined/`allow:false` ist.
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
    // Env unverändert durchreichen (PLAN §3: keine base-url/token-Injektion).
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

    // Reset des Interrupt-/Exit-Zustands für diesen Turn.
    this.#exited = false;
    this.#interrupted = false;
    this.#killTimer = null;

    let child: CliChild;
    try {
      child = this.#spawn(this.#command, inv.args, { cwd: req.siteDir, env: this.#env });
    } catch (err) {
      // Synchroner spawn-Fehler (selten) — wie ENOENT behandeln.
      const e = err as NodeJS.ErrnoException;
      yield e.code === 'ENOENT'
        ? this.#spec.notFound()
        : { type: 'error', message: 'Die CLI konnte nicht gestartet werden.', recoverable: false, cause: e.message };
      yield { type: 'turn-complete', turnId, stopReason: 'error', sessionId: state.sessionId, costUsd: state.costUsd };
      return;
    }
    this.#child = child;

    // --- Watchdog: neu armiert bei jedem stdout/stderr-CHUNK (echtes
    // Lebenszeichen), pausiert bei offener Permission-Anfrage (der Nutzer darf
    // beliebig lange überlegen — die CLI ist dann legitim still).
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
      // push nach queue.close() ist ein No-op — ein spät feuernder Timer
      // kann einen beendeten Turn nicht stören.
      idleTimer = setTimeout(() => queue.push({ kind: 'idle-timeout' }), this.#idleTimeoutMs);
      idleTimer.unref?.();
    };

    // --- stdout zeilenweise puffern → JSONL parsen (kaputte Zeilen skippen) ---
    let buffer = '';
    const pushLine = (raw: string): void => {
      const line = raw.trim();
      if (line.length === 0) return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return; // kaputte/partielle Zeile tolerant überspringen
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

    // spawn-Fehler (ENOENT) und Prozess-Ende genau einmal einreihen.
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

    // --- Prompt/Init auf stdin schreiben ---
    if (inv.stdinInit) {
      for (const obj of inv.stdinInit) child.stdin?.write(`${JSON.stringify(obj)}\n`);
    }
    if (!inv.keepStdinOpen) {
      try {
        child.stdin?.end();
      } catch {
        /* stdin evtl. schon zu */
      }
    }

    // Initial armieren — fängt auch eine CLI, die nie irgendetwas ausgibt.
    armWatchdog();

    try {
      for await (const item of queue) {
        if (item.kind === 'idle-timeout') {
          state.stopReason = 'error';
          // Erst den Prozess beenden (VOR dem yield — der Konsument könnte den
          // Strom sonst fallen lassen und die CLI liefe weiter); das close-Event
          // schließt anschließend die Queue.
          this.#terminate();
          const seconds = Math.round(this.#idleTimeoutMs / 1000);
          yield {
            type: 'error',
            message: `Die CLI hat seit ${seconds} Sekunden nicht geantwortet und wurde beendet.`,
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
                message: 'Die CLI konnte nicht gestartet werden.',
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
              message: `Die CLI wurde mit Code ${item.code ?? '?'} beendet.`,
              recoverable: true,
              ...(tail.length > 0 ? { cause: tail } : {}),
            };
          }
          continue;
        }

        // item.kind === 'json'
        const events = this.#spec.mapLine(item.value, state);
        for (const event of events) {
          // Solange eine Permission-Antwort aussteht, pausiert der Watchdog.
          if (event.type === 'permission-request') {
            watchdogPaused = true;
            stopWatchdog();
          }
          // Der Rückgabewert des yield ist die Nutzer-Entscheidung (Desktop
          // treibt mit `next(decision)`); für Nicht-Permission-Events undefined.
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
                  /* stdin evtl. schon zu — Entscheidung nicht zustellbar */
                }
              }
            }
            watchdogPaused = false;
            armWatchdog();
          }
        }

        // Logisches Turn-Ende erreicht → stdin schließen, damit die CLI beendet.
        if (state.done && inv.keepStdinOpen) {
          try {
            child.stdin?.end();
          } catch {
            /* schon zu */
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

  /** Erst höflich (SIGTERM), dann nach Grace hart (SIGKILL) — von `interrupt()` und dem Watchdog genutzt. */
  #terminate(): void {
    const child = this.#child;
    if (child === null || this.#exited) return;
    try {
      child.kill('SIGTERM');
    } catch {
      /* Prozess evtl. schon weg */
    }
    const timer = setTimeout(() => {
      if (!this.#exited) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* schon weg */
        }
      }
    }, this.#killGraceMs);
    timer.unref?.();
    this.#killTimer = timer;
  }
}

/** Erzeugt einen CLI-Adapter aus einem vendor-spezifischen {@link CliSpec}. */
export function createCliBackend(spec: CliSpec, config: CliBackendConfig = {}): AgentBackend {
  return new CliBackend(spec, config);
}
