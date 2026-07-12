/**
 * Headless-Tests der reinen Deploy-UI-Logik (kein node/electron/DOM):
 * Formular-Validierung, „Deployed"-Badge-Auflösung, Drift und der
 * Fortschritts→UI-Reducer.
 */

import { describe, expect, it } from 'vitest';

import type { Checkpoint } from '@webaibuilder/core';

import {
  computeDrift,
  defaultDeployPort,
  deployProgressReducer,
  deployedCheckpointId,
  initialDeployProgressState,
  markDeployedCheckpoints,
  resolveDeployedSha,
  validateDeployTargetInput,
  type DeployTargetInput,
  type DeployTargetView,
  type WabDeployProgressEvent,
} from './deploy';

function validInput(overrides: Partial<DeployTargetInput> = {}): DeployTargetInput {
  return {
    name: 'IONOS',
    protocol: 'sftp',
    host: 'ssh.example.org',
    port: 22,
    username: 'w012345',
    remotePath: '/htdocs',
    ...overrides,
  };
}

function view(overrides: Partial<DeployTargetView> & { id: string }): DeployTargetView {
  return {
    name: 'Ziel',
    protocol: 'sftp',
    host: 'h',
    port: 22,
    username: 'u',
    remotePath: '/',
    credentialRef: `keyring:deploy:${overrides.id}`,
    hasCredentials: true,
    ...overrides,
  };
}

function checkpoint(id: string, extra: Partial<Checkpoint> = {}): Checkpoint {
  return { id, message: `Commit ${id}`, createdAt: '2026-07-12T10:00:00.000Z', ...extra };
}

describe('defaultDeployPort', () => {
  it('liefert 22 für SFTP und 21 für FTP/FTPS', () => {
    expect(defaultDeployPort('sftp')).toBe(22);
    expect(defaultDeployPort('ftp')).toBe(21);
    expect(defaultDeployPort('ftps')).toBe(21);
  });
});

describe('validateDeployTargetInput', () => {
  it('akzeptiert ein vollständiges Ziel', () => {
    expect(validateDeployTargetInput(validInput())).toBeNull();
  });

  it('weist leeren Namen, Host, Benutzer, Pfad zurück', () => {
    expect(validateDeployTargetInput(validInput({ name: '  ' }))).toMatch(/Namen/);
    expect(validateDeployTargetInput(validInput({ host: '' }))).toMatch(/Host/);
    expect(validateDeployTargetInput(validInput({ username: '' }))).toMatch(/Benutzernamen/);
    expect(validateDeployTargetInput(validInput({ remotePath: '' }))).toMatch(/Zielverzeichnis/);
  });

  it('prüft den Port-Bereich', () => {
    expect(validateDeployTargetInput(validInput({ port: 0 }))).toMatch(/Port/);
    expect(validateDeployTargetInput(validInput({ port: 70000 }))).toMatch(/Port/);
    expect(validateDeployTargetInput(validInput({ port: 21.5 }))).toMatch(/Port/);
  });

  it('prüft das Protokoll', () => {
    expect(
      validateDeployTargetInput(validInput({ protocol: 'rsync' as unknown as 'sftp' })),
    ).toMatch(/Protokoll/);
  });
});

describe('resolveDeployedSha', () => {
  const targets = [
    view({ id: 'a', lastDeployedCommit: 'aaaaaaa000' }),
    view({ id: 'b', lastDeployedCommit: 'bbbbbbb111' }),
    view({ id: 'c' }),
  ];

  it('liefert die last_deployed-SHA des aktiven Ziels', () => {
    expect(resolveDeployedSha(targets, 'a')).toBe('aaaaaaa000');
    expect(resolveDeployedSha(targets, 'b')).toBe('bbbbbbb111');
  });

  it('liefert null ohne aktives Ziel oder ohne deployte SHA', () => {
    expect(resolveDeployedSha(targets, null)).toBeNull();
    expect(resolveDeployedSha(targets, 'c')).toBeNull();
    expect(resolveDeployedSha(targets, 'unbekannt')).toBeNull();
  });
});

describe('Badge-Auflösung (deployedCheckpointId / markDeployedCheckpoints)', () => {
  const checkpoints = [checkpoint('sha1'), checkpoint('sha2'), checkpoint('sha3')];

  it('findet den Checkpoint mit passender SHA', () => {
    expect(deployedCheckpointId(checkpoints, 'sha2')).toBe('sha2');
  });

  it('badged nur den passenden Checkpoint, alle anderen false', () => {
    const marked = markDeployedCheckpoints(checkpoints, 'sha2');
    expect(marked.map((c) => c.deployed)).toEqual([false, true, false]);
  });

  it('badged keinen, wenn die SHA nicht in der Liste ist oder leer', () => {
    expect(deployedCheckpointId(checkpoints, 'fehlt')).toBeNull();
    expect(markDeployedCheckpoints(checkpoints, null).every((c) => c.deployed === false)).toBe(true);
    expect(markDeployedCheckpoints(checkpoints, '').every((c) => c.deployed === false)).toBe(true);
  });
});

describe('computeDrift', () => {
  it('kein Drift, wenn nie deployt und remote leer', () => {
    expect(computeDrift('', null).drift).toBe(false);
  });

  it('kein Drift bei gleicher SHA', () => {
    expect(computeDrift('abc123', 'abc123').drift).toBe(false);
  });

  it('Drift bei abweichender SHA', () => {
    const d = computeDrift('abc123', 'def456');
    expect(d.drift).toBe(true);
    expect(d.expectedSha).toBe('abc123');
    expect(d.remoteSha).toBe('def456');
  });

  it('Drift, wenn erwartet deployt, aber remote nichts liegt', () => {
    expect(computeDrift('abc123', null).drift).toBe(true);
  });
});

describe('deployProgressReducer', () => {
  function run(events: WabDeployProgressEvent[]) {
    return events.reduce(deployProgressReducer, initialDeployProgressState);
  }

  it('verfolgt Upload-/Delete-Fortschritt und Endzustand', () => {
    const state = run([
      { type: 'connecting' },
      { type: 'planning' },
      { type: 'ensuring-dirs', total: 2 },
      { type: 'uploading', path: 'index.html', index: 1, total: 3 },
      { type: 'uploading', path: 'styles.css', index: 2, total: 3 },
      { type: 'deleting', path: 'alt.html', index: 1, total: 1 },
      { type: 'manifest-written', commit: 'abc1234' },
      {
        type: 'done',
        result: {
          commit: 'abc1234',
          uploaded: 3,
          deleted: 1,
          unchanged: 5,
          bytesUploaded: 2048,
          plan: { uploads: [], deletes: [], unchangedCount: 5 },
        },
      },
    ]);

    expect(state.phase).toBe('done');
    expect(state.uploaded).toBe(3);
    expect(state.deleted).toBe(1);
    expect(state.bytesUploaded).toBe(2048);
    expect(state.currentFile).toBeNull();
    expect(state.result?.unchanged).toBe(5);
  });

  it('hält den aktuellen Datei-Pfad während des Uploads', () => {
    const state = run([
      { type: 'connecting' },
      { type: 'uploading', path: 'bild.png', index: 1, total: 2 },
    ]);
    expect(state.phase).toBe('uploading');
    expect(state.currentFile).toBe('bild.png');
    expect(state.uploadTotal).toBe(2);
  });

  it('setzt Fehlerphase samt Meldung', () => {
    const state = run([{ type: 'connecting' }, { type: 'error', message: 'Verbindung weg.' }]);
    expect(state.phase).toBe('error');
    expect(state.message).toBe('Verbindung weg.');
  });

  it('connecting startet einen frischen Lauf', () => {
    const dirty = run([
      { type: 'uploading', path: 'x', index: 5, total: 9 },
      { type: 'connecting' },
    ]);
    expect(dirty.uploaded).toBe(0);
    expect(dirty.uploadTotal).toBe(0);
    expect(dirty.phase).toBe('connecting');
  });
});
