/**
 * Rotierender Datei-Logger des Main-Prozesses (M5, PLAN §1/§6).
 *
 * Schreibt strukturierte JSON-Zeilen in `<dir>/app.log`. Läuft die Datei über
 * `maxBytes`, wird sie zu `app.1.log` rotiert (bestehende Rotate-Dateien rücken
 * hoch, die älteste jenseits von `maxFiles` fällt weg). So bleibt der Platten-
 * verbrauch gedeckelt und die letzten N Dateien erhalten.
 *
 * Haltung (PLAN §1, DSGVO/Local-first): **rein lokal, kein Remote** — kein
 * Netz-Code, kein Endpunkt. `context` wird vor dem Schreiben durch
 * {@link scrubContext} geschickt, sodass nie ein API-Key/Passwort/Token in einem
 * Log landet.
 *
 * Nur node-fs, kein electron-Import → headless mit vitest testbar (Pfad wird
 * injiziert). Der App-weite Pfad (`<userData>/logs`) wird in index.ts via
 * {@link initLogger} verdrahtet.
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
  /** Verzeichnis der Log-Dateien (wird bei Bedarf angelegt). */
  dir: string;
  /** Basisname ohne Endung (Default: 'app' → app.log, app.1.log, …). */
  baseName?: string;
  /** Rotationsgrenze pro Datei in Bytes (Default: 1 MiB). */
  maxBytes?: number;
  /** Anzahl aufbewahrter Rotate-Dateien (Default: 5). */
  maxFiles?: number;
  /** Zeitquelle (Default: () => new Date()). */
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
      /* Best effort — Logging darf den Start nie verhindern. */
    }
  }

  /** Pfad der aktiven Log-Datei. */
  get filePath(): string {
    return join(this.dir, `${this.baseName}.log`);
  }

  private rotatedPath(index: number): string {
    return join(this.dir, `${this.baseName}.${index}.log`);
  }

  /**
   * Schreibt einen Eintrag. Wirft nie — Logging ist best effort und darf keinen
   * anderen Code-Pfad stören. `context` wird gescrubbt (kein Secret in Logs).
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
   * Die letzten `lines` Zeilen über die aktive + rotierten Dateien hinweg
   * (chronologisch: älteste Rotate-Datei zuerst, aktive zuletzt). Für die
   * „Logs kopieren"-Aktion. Wirft nie — liefert im Fehlerfall "".
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
   * Rotiert, falls die aktive Datei mit dem geplanten Schreiben die Grenze
   * erreicht. Reihenfolge: älteste löschen → alle hochschieben → aktive nach .1.
   * Jede fs-Operation ist einzeln abgesichert (nie Crash beim Logging).
   */
  private rotateIfNeeded(incomingBytes: number): void {
    let size = 0;
    try {
      size = existsSync(this.filePath) ? statSync(this.filePath).size : 0;
    } catch {
      /* stat fehlgeschlagen → als leer behandeln (size bleibt 0). */
    }
    if (size === 0) return; // nichts zu rotieren
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
/* Singleton pro App-Lauf (in index.ts initialisiert).                */
/* ------------------------------------------------------------------ */

let instance: FileLogger | null = null;

/** Initialisiert den App-weiten Logger einmalig (idempotent). */
export function initLogger(dir: string, options: Omit<FileLoggerOptions, 'dir'> = {}): FileLogger {
  instance ??= new FileLogger({ dir, ...options });
  return instance;
}

/** Der App-weite Logger; wirft, wenn {@link initLogger} noch nicht lief. */
export function getLogger(): FileLogger {
  if (instance === null) {
    throw new Error('Logger ist noch nicht initialisiert (initLogger fehlt).');
  }
  return instance;
}
