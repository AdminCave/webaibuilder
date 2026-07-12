/**
 * Headless-Tests des rotierenden Datei-Loggers (Node, ohne Electron). Pfad wird
 * injiziert (temp dir), wie bei den übrigen Main-Stores.
 *
 * Kernzusicherungen (PLAN §1/§6):
 *  - Rotation kappt die aktive Datei und hält nur die letzten N Rotate-Dateien.
 *  - Secret-förmiger Kontext (apiKey/password) landet NIE im Log-Klartext.
 *  - `tail(N)` liefert die letzten N Zeilen über die rotierten Dateien hinweg.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileLogger } from './logger';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wab-logs-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixedClock(): () => Date {
  let t = Date.parse('2026-07-13T00:00:00.000Z');
  return () => new Date((t += 1000));
}

describe('FileLogger — Schreiben & Scrubbing', () => {
  it('schreibt eine JSON-Zeile pro Eintrag', () => {
    const logger = new FileLogger({ dir, now: fixedClock() });
    logger.info('main', 'App bereit');
    logger.error('main', 'kaputt');

    const content = readFileSync(logger.filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(first['level']).toBe('info');
    expect(first['source']).toBe('main');
    expect(first['message']).toBe('App bereit');
    expect(first['time']).toBe('2026-07-13T00:00:01.000Z');
  });

  it('redigiert secret-förmigen Kontext (kein Klartext im Log)', () => {
    const logger = new FileLogger({ dir });
    logger.error('deploy', 'Verbindung fehlgeschlagen', {
      host: 'ssh.example.org',
      password: 'hunter2',
      apiKey: 'sk-ant-geheim',
    });

    const content = readFileSync(logger.filePath, 'utf8');
    expect(content).toContain('ssh.example.org');
    expect(content).toContain('[redaktiert]');
    expect(content).not.toContain('hunter2');
    expect(content).not.toContain('sk-ant-geheim');
  });

  it('wirft nicht, wenn ein Error-Objekt als Kontext übergeben wird', () => {
    const logger = new FileLogger({ dir });
    expect(() => logger.error('uncaught', 'boom', new Error('detail'))).not.toThrow();
    const content = readFileSync(logger.filePath, 'utf8');
    expect(content).toContain('detail');
  });
});

describe('FileLogger — Rotation & Kappung', () => {
  it('rotiert bei Überschreiten von maxBytes und hält nur maxFiles Rotate-Dateien', () => {
    const logger = new FileLogger({ dir, maxBytes: 300, maxFiles: 2, now: fixedClock() });
    for (let i = 0; i < 80; i++) {
      logger.info('main', `Zeile Nummer ${i} mit etwas Fülltext zum Aufblähen der Zeile`);
    }

    const logFiles = readdirSync(dir).filter((f) => f.endsWith('.log'));
    // Aktive Datei + höchstens maxFiles rotierte.
    expect(logFiles).toContain('app.log');
    const rotated = logFiles.filter((f) => f !== 'app.log');
    expect(rotated.length).toBeLessThanOrEqual(2);
    // Die älteste jenseits von maxFiles darf nicht existieren.
    expect(existsSync(join(dir, 'app.3.log'))).toBe(false);
  });

  it('rotiert eine leere Datei nicht', () => {
    const logger = new FileLogger({ dir, maxBytes: 1 });
    // Erste Zeile: Datei ist noch leer → kein Rotieren vor dem ersten Schreiben.
    logger.info('main', 'erste');
    expect(existsSync(join(dir, 'app.1.log'))).toBe(false);
    expect(existsSync(logger.filePath)).toBe(true);
  });
});

describe('FileLogger — tail (Logs kopieren)', () => {
  it('liefert die letzten N Zeilen', () => {
    const logger = new FileLogger({ dir, now: fixedClock() });
    for (let i = 0; i < 10; i++) logger.info('main', `m${i}`);

    const tail = logger.tail(3);
    const lines = tail.split('\n');
    expect(lines).toHaveLength(3);
    expect((JSON.parse(lines[2] as string) as Record<string, unknown>)['message']).toBe('m9');
  });

  it('kombiniert rotierte + aktive Datei chronologisch', () => {
    const logger = new FileLogger({ dir, maxBytes: 300, maxFiles: 3, now: fixedClock() });
    for (let i = 0; i < 60; i++) logger.info('main', `m${i}`);

    const tail = logger.tail(5);
    const messages = tail
      .split('\n')
      .map((l) => (JSON.parse(l) as Record<string, unknown>)['message'] as string);
    // Letzte fünf geschriebenen Nachrichten, in Reihenfolge.
    expect(messages).toEqual(['m55', 'm56', 'm57', 'm58', 'm59']);
  });

  it('liefert "" ohne Log-Dateien', () => {
    const logger = new FileLogger({ dir });
    expect(logger.tail(10)).toBe('');
  });
});
