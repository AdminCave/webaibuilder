/**
 * Tests der vendor-spezifischen Login-Proben — KEINE echten CLIs: ein
 * argument-sensitiver Fake-spawn spielt die Status-Kommandos ab. Kernzusagen:
 * eingeloggt/nicht eingeloggt werden korrekt erkannt, alles Unklare bleibt
 * fail-safe „unbekannt" (Feld fehlt), und die Versions-Probe läuft weiter mit.
 */

import { describe, expect, it } from 'vitest';

import type { SpawnFn } from '../src/cliEngine';
import { makeLoginProbe } from '../src/loginProbes';
import { FakeChild } from './helpers/fakeSpawn';

/** Antwort-Skript für ein Kommando (nach args gematcht). */
interface Scripted {
  match: (args: readonly string[]) => boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** true = nie antworten (Timeout-Fall). */
  hang?: boolean;
}

/** spawn-Fake, der pro Aufruf anhand der Argumente ein Skript abspielt. */
function scriptedByArgs(scripts: readonly Scripted[]): SpawnFn {
  return (_command, args) => {
    const child = new FakeChild();
    const script = scripts.find((s) => s.match(args));
    queueMicrotask(() => {
      if (script === undefined || script.hang === true) return; // hängt → Timeout greift
      if (script.stdout !== undefined) child.emitStdoutRaw(script.stdout);
      if (script.stderr !== undefined) {
        // FakeChild.stderr ist ein No-op-Stub — stderr-Fälle testen wir über stdout.
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
  it('erkennt eingeloggt + Konto aus der JSON-Ausgabe', async () => {
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

  it('erkennt nicht eingeloggt', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'auth', stdout: '{"loggedIn": false}\n', exitCode: 1 },
    ]);
    const result = await makeLoginProbe(spawn)('claude-cli', '/usr/bin/claude');
    expect(result.loggedIn).toBe(false);
    expect(result.account).toBeUndefined();
  });

  it('bleibt fail-safe „unbekannt" bei Nicht-JSON-Ausgabe (ältere CLI)', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'auth', stdout: 'Unknown command: auth\n', exitCode: 1 },
    ]);
    const result = await makeLoginProbe(spawn)('claude-cli', '/usr/bin/claude');
    expect(result.loggedIn).toBeUndefined();
    expect(result.version).toBe('2.1.0 (Klaus)'); // Versions-Probe unbeeinflusst
  });
});

describe('makeLoginProbe — codex (`codex login status`, Text)', () => {
  it('erkennt eingeloggt (Exit 0, „Logged in …")', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'login', stdout: 'Logged in using ChatGPT\n' },
    ]);
    const result = await makeLoginProbe(spawn)('codex', '/usr/bin/codex');
    expect(result.loggedIn).toBe(true);
  });

  it('erkennt nicht eingeloggt („Not logged in" schlägt „logged in")', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'login', stdout: 'Not logged in\n', exitCode: 1 },
    ]);
    const result = await makeLoginProbe(spawn)('codex', '/usr/bin/codex');
    expect(result.loggedIn).toBe(false);
  });

  it('unklare Ausgabe → unbekannt', async () => {
    const spawn = scriptedByArgs([
      versionScript,
      { match: (args) => args[0] === 'login', stdout: 'error: unexpected\n', exitCode: 2 },
    ]);
    const result = await makeLoginProbe(spawn)('codex', '/usr/bin/codex');
    expect(result.loggedIn).toBeUndefined();
  });
});

describe('makeLoginProbe — übrige Backends und Timeout', () => {
  it('gemini/grok: nur Versions-Probe, Login bleibt unbekannt', async () => {
    const spawn = scriptedByArgs([versionScript]);
    const gemini = await makeLoginProbe(spawn)('gemini-cli', '/usr/bin/gemini');
    expect(gemini).toEqual({ installed: true, version: '2.1.0 (Klaus)' });
    const grok = await makeLoginProbe(spawn)('grok-cli', '/usr/bin/grok');
    expect(grok.loggedIn).toBeUndefined();
  });
});
