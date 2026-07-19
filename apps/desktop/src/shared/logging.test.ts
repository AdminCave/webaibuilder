import { describe, expect, it } from 'vitest';

import {
  formatLogLine,
  isSecretKey,
  REDACTED,
  scrubContext,
  scrubSecrets,
  selectLastLines,
  shouldRotate,
  type LogEntry,
} from './logging';

describe('isSecretKey', () => {
  it('detects secret-shaped field names (case-insensitive, substring)', () => {
    for (const key of ['apiKey', 'API_KEY', 'password', 'passwort', 'passphrase', 'token', 'accessToken', 'clientSecret', 'authorization', 'Cookie', 'privateKey', 'sessionId']) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('leaves harmless field names alone', () => {
    for (const key of ['host', 'port', 'username', 'projectId', 'backendId', 'message', 'count']) {
      expect(isSecretKey(key)).toBe(false);
    }
  });
});

describe('scrubSecrets', () => {
  it('redacts apiKey/password and leaves the rest', () => {
    const input = {
      host: 'ssh.example.org',
      username: 'w0',
      apiKey: 'sk-ant-super-geheim',
      password: 'hunter2',
    };
    const out = scrubSecrets(input) as Record<string, unknown>;
    expect(out['host']).toBe('ssh.example.org');
    expect(out['username']).toBe('w0');
    expect(out['apiKey']).toBe(REDACTED);
    expect(out['password']).toBe(REDACTED);
    // The plaintext appears nowhere in the serialized result.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('sk-ant-super-geheim');
    expect(serialized).not.toContain('hunter2');
  });

  it('scrubs nested objects and arrays', () => {
    const input = {
      targets: [
        { name: 'IONOS', password: 'geheim1' },
        { name: 'Strato', credentials: { token: 'tok-123' } },
      ],
    };
    const serialized = JSON.stringify(scrubSecrets(input));
    expect(serialized).not.toContain('geheim1');
    expect(serialized).not.toContain('tok-123');
    expect(serialized).toContain('IONOS');
    expect(serialized).toContain('Strato');
  });

  it('breaks cycles cleanly (no stack overflow)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    expect(() => scrubSecrets(a)).not.toThrow();
    const out = scrubSecrets(a) as Record<string, unknown>;
    expect(out['name']).toBe('a');
    expect(out['self']).toBe('[circular]');
  });

  it('serializes Error objects to name/message/stack', () => {
    const out = scrubSecrets(new Error('kaputt')) as Record<string, unknown>;
    expect(out['name']).toBe('Error');
    expect(out['message']).toBe('kaputt');
    expect(out).toHaveProperty('stack');
  });

  it('passes primitives through unchanged', () => {
    expect(scrubSecrets('text')).toBe('text');
    expect(scrubSecrets(42)).toBe(42);
    expect(scrubSecrets(null)).toBe(null);
  });
});

describe('scrubContext', () => {
  it('always returns an object (primitives are wrapped)', () => {
    expect(scrubContext({ a: 1 })).toEqual({ a: 1 });
    expect(scrubContext('nur-text')).toEqual({ value: 'nur-text' });
    expect(scrubContext([1, 2])).toEqual({ value: [1, 2] });
  });
});

describe('formatLogLine', () => {
  it('serializes exactly one line with \\n', () => {
    const entry: LogEntry = {
      time: '2026-07-13T00:00:00.000Z',
      level: 'error',
      source: 'main',
      message: 'etwas ging schief',
    };
    const line = formatLogLine(entry);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line) as LogEntry).toEqual(entry);
  });
});

describe('selectLastLines', () => {
  const text = 'z1\nz2\nz3\nz4\nz5\n';

  it('returns the last N lines', () => {
    expect(selectLastLines(text, 2)).toBe('z4\nz5');
    expect(selectLastLines(text, 3)).toBe('z3\nz4\nz5');
  });

  it('returns all lines when N exceeds the count', () => {
    expect(selectLastLines(text, 99)).toBe('z1\nz2\nz3\nz4\nz5');
  });

  it('treats N<=0 and empty text as empty', () => {
    expect(selectLastLines(text, 0)).toBe('');
    expect(selectLastLines(text, -1)).toBe('');
    expect(selectLastLines('', 5)).toBe('');
  });

  it('handles text without a trailing newline', () => {
    expect(selectLastLines('a\nb\nc', 2)).toBe('b\nc');
  });
});

describe('shouldRotate', () => {
  it('rotates once the limit is reached', () => {
    expect(shouldRotate(999, 1000)).toBe(false);
    expect(shouldRotate(1000, 1000)).toBe(true);
    expect(shouldRotate(1500, 1000)).toBe(true);
  });

  it('disables rotation when maxBytes<=0', () => {
    expect(shouldRotate(10_000, 0)).toBe(false);
    expect(shouldRotate(10_000, -1)).toBe(false);
  });
});
