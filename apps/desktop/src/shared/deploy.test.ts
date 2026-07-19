/**
 * Headless tests of the pure deploy UI logic (no node/electron/DOM): form
 * validation, "deployed" badge resolution, drift, and the progress → UI
 * reducer.
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
  it('returns 22 for SFTP and 21 for FTP/FTPS', () => {
    expect(defaultDeployPort('sftp')).toBe(22);
    expect(defaultDeployPort('ftp')).toBe(21);
    expect(defaultDeployPort('ftps')).toBe(21);
  });
});

describe('validateDeployTargetInput', () => {
  it('accepts a complete target', () => {
    expect(validateDeployTargetInput(validInput())).toBeNull();
  });

  it('rejects an empty name, host, user, path', () => {
    expect(validateDeployTargetInput(validInput({ name: '  ' }))).toMatch(/name/);
    expect(validateDeployTargetInput(validInput({ host: '' }))).toMatch(/host/);
    expect(validateDeployTargetInput(validInput({ username: '' }))).toMatch(/username/);
    expect(validateDeployTargetInput(validInput({ remotePath: '' }))).toMatch(/target directory/);
  });

  it('checks the port range', () => {
    expect(validateDeployTargetInput(validInput({ port: 0 }))).toMatch(/port/);
    expect(validateDeployTargetInput(validInput({ port: 70000 }))).toMatch(/port/);
    expect(validateDeployTargetInput(validInput({ port: 21.5 }))).toMatch(/port/);
  });

  it('checks the protocol', () => {
    expect(
      validateDeployTargetInput(validInput({ protocol: 'rsync' as unknown as 'sftp' })),
    ).toMatch(/protocol/);
  });
});

describe('resolveDeployedSha', () => {
  const targets = [
    view({ id: 'a', lastDeployedCommit: 'aaaaaaa000' }),
    view({ id: 'b', lastDeployedCommit: 'bbbbbbb111' }),
    view({ id: 'c' }),
  ];

  it('returns the last_deployed SHA of the active target', () => {
    expect(resolveDeployedSha(targets, 'a')).toBe('aaaaaaa000');
    expect(resolveDeployedSha(targets, 'b')).toBe('bbbbbbb111');
  });

  it('returns null without an active target or without a deployed SHA', () => {
    expect(resolveDeployedSha(targets, null)).toBeNull();
    expect(resolveDeployedSha(targets, 'c')).toBeNull();
    expect(resolveDeployedSha(targets, 'unbekannt')).toBeNull();
  });
});

describe('Badge resolution (deployedCheckpointId / markDeployedCheckpoints)', () => {
  const checkpoints = [checkpoint('sha1'), checkpoint('sha2'), checkpoint('sha3')];

  it('finds the checkpoint with the matching SHA', () => {
    expect(deployedCheckpointId(checkpoints, 'sha2')).toBe('sha2');
  });

  it('badges only the matching checkpoint, all others false', () => {
    const marked = markDeployedCheckpoints(checkpoints, 'sha2');
    expect(marked.map((c) => c.deployed)).toEqual([false, true, false]);
  });

  it('badges none when the SHA is not in the list or empty', () => {
    expect(deployedCheckpointId(checkpoints, 'fehlt')).toBeNull();
    expect(markDeployedCheckpoints(checkpoints, null).every((c) => c.deployed === false)).toBe(true);
    expect(markDeployedCheckpoints(checkpoints, '').every((c) => c.deployed === false)).toBe(true);
  });
});

describe('computeDrift', () => {
  it('no drift when never deployed and remote empty', () => {
    expect(computeDrift('', null).drift).toBe(false);
  });

  it('no drift for the same SHA', () => {
    expect(computeDrift('abc123', 'abc123').drift).toBe(false);
  });

  it('drift for a differing SHA', () => {
    const d = computeDrift('abc123', 'def456');
    expect(d.drift).toBe(true);
    expect(d.expectedSha).toBe('abc123');
    expect(d.remoteSha).toBe('def456');
  });

  it('drift when a deploy is expected but nothing is on the remote', () => {
    expect(computeDrift('abc123', null).drift).toBe(true);
  });
});

describe('deployProgressReducer', () => {
  function run(events: WabDeployProgressEvent[]) {
    return events.reduce(deployProgressReducer, initialDeployProgressState);
  }

  it('tracks upload/delete progress and the final state', () => {
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

  it('holds the current file path during upload', () => {
    const state = run([
      { type: 'connecting' },
      { type: 'uploading', path: 'bild.png', index: 1, total: 2 },
    ]);
    expect(state.phase).toBe('uploading');
    expect(state.currentFile).toBe('bild.png');
    expect(state.uploadTotal).toBe(2);
  });

  it('sets the error phase along with the message', () => {
    const state = run([{ type: 'connecting' }, { type: 'error', message: 'Verbindung weg.' }]);
    expect(state.phase).toBe('error');
    expect(state.message).toBe('Verbindung weg.');
  });

  it('connecting starts a fresh run', () => {
    const dirty = run([
      { type: 'uploading', path: 'x', index: 5, total: 9 },
      { type: 'connecting' },
    ]);
    expect(dirty.uploaded).toBe(0);
    expect(dirty.uploadTotal).toBe(0);
    expect(dirty.phase).toBe('connecting');
  });
});
