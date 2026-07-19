/**
 * Tests for the vendor-specific login probes — NO real CLIs: an argument-aware
 * fake spawn plays back the status commands. Core guarantees: logged in / not
 * logged in are detected correctly, anything unclear stays fail-safe "unknown"
 * (field absent), and the version probe still runs alongside.
 */

import { describe, expect, it } from 'vitest';

import type { SpawnFn } from '../src/cliEngine';
import { makeLoginProbe } from '../src/loginProbes';
import { FakeChild } from './helpers/fakeSpawn';

/** Response script for a command (matched by args). */
interface Scripted {
  match: (args: readonly string[]) => boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** true = never respond (timeout case). */
  hang?: boolean;
}

/** spawn fake that plays back a script per call based on the arguments. */
function scriptedByArgs(scripts: readonly Scripted[]): SpawnFn {
  return (_command, args) => {
    const child = new FakeChild();
    const script = scripts.find((s) => s.match(args));
    queueMicrotask(() => {
      if (script === undefined || script.hang === true) return; // hangs → timeout kicks in
      if (script.stdout !== undefined) child.emitStdoutRaw(script.stdout);
      if (script.stderr !== undefined) {
        // FakeChild.stderr is a no-op stub — we test stderr cases via stdout.
      }
      child.emitClose(script.exitCode ?? 0, null);
    });
    return child;
  };
}

const versionScript: Scripted = {
  match: (args) => args[0] === '--version',
  stdout: '2.1.0 (Klaus)\n',
};

describe('makeLoginProbe — claude-cli (`claude auth status`, JSON)', () => {
  it('detects logged in + account from the JSON output', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      {
        match: (args) => args[0] === 'auth' && args[1] === 'status',
        stdout: '{"loggedIn": true, "authMethod": "claude.ai", "email": "kevin@example.de"}\n',
      },
    ]);
    const result = await makeLoginProbe(spawn)('claude-cli', '/usr/bin/claude');
    expect(result).toMatchObject({
      installed: true,
      version: '2.1.0 (Klaus)',
      loggedIn: true,
      account: 'kevin@example.de',
    });
  });

  it('detects not logged in', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'auth', stdout: '{"loggedIn": false}\n', exitCode: 1 },
    ]);
    const result = await makeLoginProbe(spawn)('claude-cli', '/usr/bin/claude');
    expect(result.loggedIn).toBe(false);
    expect(result.account).toBeUndefined();
  });

  it('stays fail-safe "unknown" on non-JSON output (older CLI)', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'auth', stdout: 'Unknown command: auth\n', exitCode: 1 },
    ]);
    const result = await makeLoginProbe(spawn)('claude-cli', '/usr/bin/claude');
    expect(result.loggedIn).toBeUndefined();
    expect(result.version).toBe('2.1.0 (Klaus)'); // version probe unaffected
  });
});

describe('makeLoginProbe — codex (`codex login status`, text)', () => {
  it('detects logged in (exit 0, "Logged in …")', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'login', stdout: 'Logged in using ChatGPT\n' },
    ]);
    const result = await makeLoginProbe(spawn)('codex', '/usr/bin/codex');
    expect(result.loggedIn).toBe(true);
  });

  it('detects not logged in ("Not logged in" beats "logged in")', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'login', stdout: 'Not logged in\n', exitCode: 1 },
    ]);
    const result = await makeLoginProbe(spawn)('codex', '/usr/bin/codex');
    expect(result.loggedIn).toBe(false);
  });

  it('unclear output → unknown', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'login', stdout: 'error: unexpected\n', exitCode: 2 },
    ]);
    const result = await makeLoginProbe(spawn)('codex', '/usr/bin/codex');
    expect(result.loggedIn).toBeUndefined();
  });
});

describe('makeLoginProbe — remaining backends and timeout', () => {
  it('gemini/grok: version probe only, login stays unknown', async () => {
    const spawn = scriptedByArgs([versionScript]);
    const gemini = await makeLoginProbe(spawn)('gemini-cli', '/usr/bin/gemini');
    expect(gemini).toEqual({ installed: true, version: '2.1.0 (Klaus)' });
    const grok = await makeLoginProbe(spawn)('grok-cli', '/usr/bin/grok');
    expect(grok.loggedIn).toBeUndefined();
  });
});
