/**
 * Error reports & logs (M5, PLAN §1/§6) — pure, environment-neutral building
 * blocks.
 *
 * Stance (PLAN §1, GDPR/local-first): **local, no remote.** There is no network
 * code and no endpoint here whatsoever. Logs stay on the user's machine (a
 * rotating file under `<userData>/logs/`, see main/logger.ts).
 *
 * This file holds only pure logic (no node/electron/DOM) and is therefore
 * headless-testable:
 *  - {@link scrubSecrets}: removes secret-shaped fields BEFORE writing, so an API
 *    key/password/token never ends up in a log.
 *  - {@link selectLastLines}: "last N lines" for the "Copy logs" action.
 *  - {@link formatLogLine}/{@link shouldRotate}: line format + rotation criterion.
 *
 * The fs-bound writer/rotator lives in main/logger.ts.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** A structured log entry (one JSON line in the file). */
export interface LogEntry {
  /** ISO timestamp. */
  time: string;
  level: LogLevel;
  /** Origin: 'main' | 'renderer' | 'uncaughtException' | … (free-form, short). */
  source: string;
  message: string;
  /** Optional, already-scrubbed context. */
  context?: Record<string, unknown>;
}

/**
 * Renderer error reported by the sandbox (window.onerror /
 * unhandledrejection). Environment-neutral so the typed IPC channel can transport
 * it.
 */
export interface RendererErrorReport {
  kind: 'error' | 'unhandledrejection';
  message: string;
  stack?: string;
  /** URL/source the error originates from. */
  source?: string;
  line?: number;
  column?: number;
}

/** The replacement text for a redacted (secret-shaped) field. */
export const REDACTED = '[redacted]';

/**
 * Field-name patterns that indicate a secret (substring, case-insensitive).
 * Conservatively biased toward over-redaction: an over-redacted log field is
 * harmless, a leaked key is not. Covers the secret fields that actually occur in
 * the code (apiKey, password/passwort, passphrase, token, …).
 */
export const SECRET_KEY_PATTERNS: readonly string[] = [
  'apikey',
  'api_key',
  'password',
  'passwort',
  'passphrase',
  'secret',
  'token',
  'credential',
  'authorization',
  'cookie',
  'privatekey',
  'private_key',
  'sessionid',
];

/** Does this field name look suspiciously like a secret? */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => k.includes(pattern));
}

/**
 * Copies an arbitrary value while redacting every secret-shaped field. Recursive
 * over objects/arrays, robust against cycles and excessive depth. Primitives are
 * passed through unchanged — redaction is based solely on the field name (not the
 * value), so legitimate log values are preserved.
 */
export function scrubSecrets(value: unknown): unknown {
  return scrub(value, 0, new WeakSet());
}

const MAX_SCRUB_DEPTH = 6;

function scrub(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_SCRUB_DEPTH) return '[too deep]';
  if (typeof value !== 'object' || value === null) return value;

  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1, seen));
  }

  // Serialize Error cleanly, but without possibly secret-bearing extra fields.
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : scrub(item, depth + 1, seen);
  }
  return out;
}

/**
 * Applies {@link scrubSecrets} to a context and guarantees an object (never an
 * array/primitive) — matching {@link LogEntry.context}.
 */
export function scrubContext(context: unknown): Record<string, unknown> {
  const scrubbed = scrubSecrets(context);
  if (typeof scrubbed === 'object' && scrubbed !== null && !Array.isArray(scrubbed)) {
    return scrubbed as Record<string, unknown>;
  }
  return { value: scrubbed };
}

/** Serializes an entry as exactly one line (with a trailing \n). */
export function formatLogLine(entry: LogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Selects the last `n` lines from `text`. A single trailing line break does not
 * count as an empty line. `n <= 0` or empty text → "".
 */
export function selectLastLines(text: string, n: number): string {
  if (n <= 0 || text === '') return '';
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n).join('\n');
}

/**
 * Rotation criterion: a file is full once it reaches the limit (after the planned
 * write). `maxBytes <= 0` disables rotation.
 */
export function shouldRotate(sizeBytes: number, maxBytes: number): boolean {
  return maxBytes > 0 && sizeBytes >= maxBytes;
}
