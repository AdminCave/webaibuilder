/**
 * Headless tests of the rotating file logger (Node, without Electron). The path is
 * injected (temp dir), as with the other main stores.
 *
 * Core guarantees (PLAN §1/§6):
 *  - Rotation caps the active file and keeps only the last N rotate files.
 *  - Secret-shaped context (apiKey/password) NEVER ends up in the log plaintext.
 *  - `tail(N)` returns the last N lines across the rotated files.
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

describe('FileLogger — writing & scrubbing', () => {
  it('writes one JSON line per entry', () => {
    const logger = new FileLogger({ dir, now: fixedClock() });
    logger.info('main', 'App ready');
    logger.error('main', 'broken');

    const content = readFileSync(logger.filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(first['level']).toBe('info');
    expect(first['source']).toBe('main');
    expect(first['message']).toBe('App ready');
    expect(first['time']).toBe('2026-07-13T00:00:01.000Z');
  });

  it('redacts secret-shaped context (no plaintext in the log)', () => {
    const logger = new FileLogger({ dir });
    logger.error('deploy', 'Connection failed', {
      host: 'ssh.example.org',
      password: 'hunter2',
      apiKey: 'sk-ant-secret',
    });

    const content = readFileSync(logger.filePath, 'utf8');
    expect(content).toContain('ssh.example.org');
    expect(content).toContain('[redacted]');
    expect(content).not.toContain('hunter2');
    expect(content).not.toContain('sk-ant-secret');
  });

  it('does not throw when an Error object is passed as context', () => {
    const logger = new FileLogger({ dir });
    expect(() => logger.error('uncaught', 'boom', new Error('detail'))).not.toThrow();
    const content = readFileSync(logger.filePath, 'utf8');
    expect(content).toContain('detail');
  });
});

describe('FileLogger — rotation & capping', () => {
  it('rotates when maxBytes is exceeded and keeps only maxFiles rotate files', () => {
    const logger = new FileLogger({ dir, maxBytes: 300, maxFiles: 2, now: fixedClock() });
    for (let i = 0; i < 80; i++) {
      logger.info('main', `Line number ${i} with some filler text to pad out the line`);
    }

    const logFiles = readdirSync(dir).filter((f) => f.endsWith('.log'));
    // Active file + at most maxFiles rotated.
    expect(logFiles).toContain('app.log');
    const rotated = logFiles.filter((f) => f !== 'app.log');
    expect(rotated.length).toBeLessThanOrEqual(2);
    // The oldest beyond maxFiles must not exist.
    expect(existsSync(join(dir, 'app.3.log'))).toBe(false);
  });

  it('does not rotate an empty file', () => {
    const logger = new FileLogger({ dir, maxBytes: 1 });
    // First line: the file is still empty → no rotation before the first write.
    logger.info('main', 'first');
    expect(existsSync(join(dir, 'app.1.log'))).toBe(false);
    expect(existsSync(logger.filePath)).toBe(true);
  });
});

describe('FileLogger — tail (copy logs)', () => {
  it('returns the last N lines', () => {
    const logger = new FileLogger({ dir, now: fixedClock() });
    for (let i = 0; i < 10; i++) logger.info('main', `m${i}`);

    const tail = logger.tail(3);
    const lines = tail.split('\n');
    expect(lines).toHaveLength(3);
    expect((JSON.parse(lines[2] as string) as Record<string, unknown>)['message']).toBe('m9');
  });

  it('combines rotated + active file chronologically', () => {
    const logger = new FileLogger({ dir, maxBytes: 300, maxFiles: 3, now: fixedClock() });
    for (let i = 0; i < 60; i++) logger.info('main', `m${i}`);

    const tail = logger.tail(5);
    const messages = tail
      .split('\n')
      .map((l) => (JSON.parse(l) as Record<string, unknown>)['message'] as string);
    // The last five written messages, in order.
    expect(messages).toEqual(['m55', 'm56', 'm57', 'm58', 'm59']);
  });

  it('returns "" without log files', () => {
    const logger = new FileLogger({ dir });
    expect(logger.tail(10)).toBe('');
  });
});
