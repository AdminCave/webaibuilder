/**
 * Rotating file logger of the main process (M5, PLAN §1/§6).
 *
 * Writes structured JSON lines to `<dir>/app.log`. When the file exceeds
 * `maxBytes`, it is rotated to `app.1.log` (existing rotate files move up, the
 * oldest beyond `maxFiles` is dropped). This keeps disk usage capped and the
 * last N files retained.
 *
 * Stance (PLAN §1, GDPR/local-first): **purely local, no remote** — no network
 * code, no endpoint. `context` is passed through {@link scrubContext} before
 * writing, so an API key/password/token never ends up in a log.
 *
 * Only node-fs, no electron import → headless testable with vitest (the path is
 * injected). The app-wide path (`<userData>/logs`) is wired up in index.ts via
 * {@link initLogger}.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  formatLogLine,
  scrubContext,
  selectLastLines,
  shouldRotate,
  type LogEntry,
  type LogLevel,
} from '../shared/logging';

export interface FileLoggerOptions {
  /** Directory of the log files (created on demand). */
  dir: string;
  /** Base name without extension (default: 'app' → app.log, app.1.log, …). */
  baseName?: string;
  /** Rotation threshold per file in bytes (default: 1 MiB). */
  maxBytes?: number;
  /** Number of retained rotate files (default: 5). */
  maxFiles?: number;
  /** Time source (default: () => new Date()). */
  now?: () => Date;
}

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB
const DEFAULT_MAX_FILES = 5;

export class FileLogger {
  readonly dir: string;
  readonly baseName: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  private readonly now: () => Date;

  constructor(options: FileLoggerOptions) {
    this.dir = options.dir;
    this.baseName = options.baseName ?? 'app';
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.now = options.now ?? (() => new Date());
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* Best effort — logging must never prevent startup. */
    }
  }

  /** Path of the active log file. */
  get filePath(): string {
    return join(this.dir, `${this.baseName}.log`);
  }

  private rotatedPath(index: number): string {
    return join(this.dir, `${this.baseName}.${index}.log`);
  }

  /**
   * Writes an entry. Never throws — logging is best effort and must not disturb
   * any other code path. `context` is scrubbed (no secret in logs).
   */
  log(level: LogLevel, source: string, message: string, context?: unknown): void {
    const entry: LogEntry = {
      time: this.now().toISOString(),
      level,
      source,
      message,
      ...(context !== undefined ? { context: scrubContext(context) } : {}),
    };
    const line = formatLogLine(entry);
    try {
      this.rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(this.filePath, line);
    } catch {
      /* Best effort. */
    }
  }

  info(source: string, message: string, context?: unknown): void {
    this.log('info', source, message, context);
  }

  warn(source: string, message: string, context?: unknown): void {
    this.log('warn', source, message, context);
  }

  error(source: string, message: string, context?: unknown): void {
    this.log('error', source, message, context);
  }

  /**
   * The last `lines` lines across the active + rotated files (chronologically:
   * oldest rotate file first, active last). For the "Copy logs" action. Never
   * throws — returns "" on error.
   */
  tail(lines: number): string {
    try {
      const parts: string[] = [];
      for (let i = this.maxFiles; i >= 1; i--) {
        const path = this.rotatedPath(i);
        if (existsSync(path)) parts.push(readFileSync(path, 'utf8'));
      }
      if (existsSync(this.filePath)) parts.push(readFileSync(this.filePath, 'utf8'));
      return selectLastLines(parts.join(''), lines);
    } catch {
      return '';
    }
  }

  /**
   * Rotates if the active file reaches the limit with the planned write. Order:
   * delete the oldest → shift all up → active to .1. Each fs operation is
   * individually guarded (never a crash while logging).
   */
  private rotateIfNeeded(incomingBytes: number): void {
    let size = 0;
    try {
      size = existsSync(this.filePath) ? statSync(this.filePath).size : 0;
    } catch {
      /* stat failed → treat as empty (size stays 0). */
    }
    if (size === 0) return; // nothing to rotate
    if (!shouldRotate(size + incomingBytes, this.maxBytes)) return;

    const oldest = this.rotatedPath(this.maxFiles);
    try {
      if (existsSync(oldest)) rmSync(oldest);
    } catch {
      /* ignore */
    }
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = this.rotatedPath(i);
      const to = this.rotatedPath(i + 1);
      try {
        if (existsSync(from)) renameSync(from, to);
      } catch {
        /* ignore */
      }
    }
    try {
      renameSync(this.filePath, this.rotatedPath(1));
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Singleton per app run (initialized in index.ts).                   */
/* ------------------------------------------------------------------ */

let instance: FileLogger | null = null;

/** Initializes the app-wide logger once (idempotent). */
export function initLogger(dir: string, options: Omit<FileLoggerOptions, 'dir'> = {}): FileLogger {
  instance ??= new FileLogger({ dir, ...options });
  return instance;
}

/** The app-wide logger; throws if {@link initLogger} has not run yet. */
export function getLogger(): FileLogger {
  if (instance === null) {
    throw new Error('Logger is not yet initialized (initLogger missing).');
  }
  return instance;
}
