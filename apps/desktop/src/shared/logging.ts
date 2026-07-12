/**
 * Fehlerberichte & Logs (M5, PLAN §1/§6) — reine, umgebungsneutrale Bausteine.
 *
 * Haltung (PLAN §1, DSGVO/Local-first): **lokal, kein Remote.** Es gibt hier
 * keinerlei Netz-Code und keinen Endpunkt. Logs bleiben auf dem Rechner des
 * Nutzers (rotierende Datei unter `<userData>/logs/`, siehe main/logger.ts).
 *
 * Diese Datei hält nur reine Logik (kein node/electron/DOM) und ist damit
 * headless testbar:
 *  - {@link scrubSecrets}: entfernt secret-förmige Felder VOR dem Schreiben, damit
 *    nie ein API-Key/Passwort/Token in einem Log landet.
 *  - {@link selectLastLines}: „letzte N Zeilen" für die „Logs kopieren"-Aktion.
 *  - {@link formatLogLine}/{@link shouldRotate}: Zeilen-Format + Rotations-Kriterium.
 *
 * Der fs-gebundene Schreiber/Rotierer liegt in main/logger.ts.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** Ein strukturierter Log-Eintrag (eine JSON-Zeile in der Datei). */
export interface LogEntry {
  /** ISO-Zeitstempel. */
  time: string;
  level: LogLevel;
  /** Herkunft: 'main' | 'renderer' | 'uncaughtException' | … (frei, kurz). */
  source: string;
  message: string;
  /** Optionaler, bereits gescrubbter Kontext. */
  context?: Record<string, unknown>;
}

/**
 * Von der Sandbox gemeldeter Renderer-Fehler (window.onerror /
 * unhandledrejection). Umgebungsneutral, damit der typisierte IPC-Kanal ihn
 * transportieren kann.
 */
export interface RendererErrorReport {
  kind: 'error' | 'unhandledrejection';
  message: string;
  stack?: string;
  /** URL/Quelle, aus der der Fehler stammt. */
  source?: string;
  line?: number;
  column?: number;
}

/** Der Ersetzungstext für ein redigiertes (secret-förmiges) Feld. */
export const REDACTED = '[redaktiert]';

/**
 * Feldnamen-Muster, die auf ein Secret hindeuten (Teilstring, case-insensitiv).
 * Konservativ in Richtung Über-Redaktion: ein zu viel geschwärztes Log-Feld ist
 * harmlos, ein durchgesickerter Key nicht. Deckt die im Code real vorkommenden
 * Secret-Felder ab (apiKey, password/passwort, passphrase, token, …).
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

/** Heißt dieses Feld verdächtig nach einem Secret? */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => k.includes(pattern));
}

/**
 * Kopiert einen beliebigen Wert und schwärzt dabei jedes secret-förmige Feld.
 * Rekursiv über Objekte/Arrays, robust gegen Zyklen und übermäßige Tiefe.
 * Primitive werden unverändert durchgereicht — geschwärzt wird ausschließlich
 * anhand des Feldnamens (nicht des Werts), damit legitime Log-Werte erhalten
 * bleiben.
 */
export function scrubSecrets(value: unknown): unknown {
  return scrub(value, 0, new WeakSet());
}

const MAX_SCRUB_DEPTH = 6;

function scrub(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_SCRUB_DEPTH) return '[zu tief]';
  if (typeof value !== 'object' || value === null) return value;

  const obj = value as object;
  if (seen.has(obj)) return '[zirkulär]';
  seen.add(obj);

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1, seen));
  }

  // Error sauber, aber ohne womöglich secret-tragende Zusatzfelder serialisieren.
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
 * Wendet {@link scrubSecrets} auf einen Kontext an und garantiert ein Objekt
 * (nie ein Array/Primitive) — passend zu {@link LogEntry.context}.
 */
export function scrubContext(context: unknown): Record<string, unknown> {
  const scrubbed = scrubSecrets(context);
  if (typeof scrubbed === 'object' && scrubbed !== null && !Array.isArray(scrubbed)) {
    return scrubbed as Record<string, unknown>;
  }
  return { value: scrubbed };
}

/** Serialisiert einen Eintrag als genau eine Zeile (mit abschließendem \n). */
export function formatLogLine(entry: LogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Wählt die letzten `n` Zeilen aus `text`. Ein einzelnes abschließendes
 * Zeilenende zählt nicht als leere Zeile. `n <= 0` oder leerer Text → "".
 */
export function selectLastLines(text: string, n: number): string {
  if (n <= 0 || text === '') return '';
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n).join('\n');
}

/**
 * Rotations-Kriterium: eine Datei ist voll, sobald sie (nach dem geplanten
 * Schreiben) die Obergrenze erreicht. `maxBytes <= 0` schaltet Rotation aus.
 */
export function shouldRotate(sizeBytes: number, maxBytes: number): boolean {
  return maxBytes > 0 && sizeBytes >= maxBytes;
}
