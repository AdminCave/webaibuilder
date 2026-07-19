/**
 * Round-trip tests for the versioning: init → checkpoint → list → name →
 * restore, for BOTH backends (system-git via simple-git, isomorphic-git).
 * The backend is forced per suite via WAB_GIT_BACKEND.
 */

import nodeFs from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import git from 'isomorphic-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createCheckpoint,
  currentSha,
  initWorkspace,
  listCheckpoints,
  nameVersion,
  restoreCheckpoint,
} from '../src/index';

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Backend-neutral clean check via isomorphic-git (reads any git repo). */
async function isClean(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs: nodeFs, dir });
  return matrix.every(([, head, workdir, stage]) => head === 1 && workdir === 1 && stage === 1);
}

/** Contents of .git/HEAD — "ref: refs/heads/main" = on branch, not detached. */
async function headRef(dir: string): Promise<string> {
  return (await readFile(join(dir, '.git', 'HEAD'), 'utf8')).trim();
}

async function makeWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe.each([['system'], ['isomorphic']] as const)('Backend: %s', (backendKind) => {
  let ws: string;

  beforeEach(async () => {
    process.env['WAB_GIT_BACKEND'] = backendKind;
    ws = await makeWorkspace(`wab-versioning-${backendKind}-`);
  });

  afterEach(async () => {
    delete process.env['WAB_GIT_BACKEND'];
    await rm(ws, { recursive: true, force: true });
  });

  it('initWorkspace creates repo, .gitignore and first commit (idempotent)', async () => {
    await initWorkspace(ws);

    expect(existsSync(join(ws, '.git'))).toBe(true);
    const gitignore = await readFile(join(ws, '.gitignore'), 'utf8');
    expect(gitignore).toContain('project.json');

    const list = await listCheckpoints(ws);
    expect(list).toHaveLength(1);
    expect(list[0]?.message).toBe('Project created');
    expect(await headRef(ws)).toBe('ref: refs/heads/main');
    expect(await isClean(ws)).toBe(true);

    // A second call changes nothing.
    await initWorkspace(ws);
    expect(await listCheckpoints(ws)).toHaveLength(1);
  });

  it('createCheckpoint commits everything and reads back trailer metadata', async () => {
    await initWorkspace(ws);
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>Hallo</h1>');

    const cp = await createCheckpoint(ws, 'Bau mir eine Vereinsseite\nMit Terminen und Kontakt.', {
      turnId: 'turn-1',
      backend: 'claude-sdk',
      sessionId: 'sess-abc',
      costUsd: 0.0421,
    });

    expect(cp.id).toMatch(FULL_SHA);
    expect(cp.message).toBe('Bau mir eine Vereinsseite');
    expect(Number.isNaN(Date.parse(cp.createdAt))).toBe(false);
    expect(cp.turnId).toBe('turn-1');
    expect(cp.backend).toBe('claude-sdk');
    expect(cp.sessionId).toBe('sess-abc');
    expect(cp.costUsd).toBeCloseTo(0.0421, 6);

    // Round-trip via git log (newest first).
    const list = await listCheckpoints(ws);
    expect(list[0]?.id).toBe(cp.id);
    expect(list[0]?.message).toBe('Bau mir eine Vereinsseite');
    expect(list[0]?.turnId).toBe('turn-1');
    expect(list[0]?.backend).toBe('claude-sdk');
    expect(list[0]?.sessionId).toBe('sess-abc');
    expect(list[0]?.costUsd).toBeCloseTo(0.0421, 6);
    expect(list[1]?.message).toBe('Project created');

    expect(await isClean(ws)).toBe(true);
    expect(await currentSha(ws)).toBe(cp.id);
  });

  it('ignores project.json (app metadata is not part of the checkpoints)', async () => {
    await initWorkspace(ws);
    await writeFile(join(ws, 'project.json'), '{"id":"p1"}');
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>Test</h1>');
    await createCheckpoint(ws, 'Erste Seite');

    const tracked = await git.listFiles({ fs: nodeFs, dir: ws, ref: 'HEAD' });
    expect(tracked).toContain('site/index.html');
    expect(tracked).not.toContain('project.json');
  });

  it('nameVersion creates annotated tag; listCheckpoints returns versionName', async () => {
    await initWorkspace(ws);
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>v1</h1>');
    const cp = await createCheckpoint(ws, 'Erste Seite');

    const named = await nameVersion(ws, cp.id, 'Schöne Startversion');
    expect(named.sha).toBe(cp.id);
    expect(named.name).toBe('Schöne Startversion');
    expect(named.tagName).toBe('wab/schoene-startversion');

    const list = await listCheckpoints(ws);
    expect(list.find((c) => c.id === cp.id)?.versionName).toBe('Schöne Startversion');

    // Name collision → unique tag name.
    const named2 = await nameVersion(ws, cp.id, 'Schöne Startversion');
    expect(named2.tagName).toBe('wab/schoene-startversion-2');
  });

  it('restore = new commit: linear, lossless, no detached HEAD', async () => {
    await initWorkspace(ws);
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>v1</h1>');
    const cp1 = await createCheckpoint(ws, 'Erste Seite');

    await writeFile(join(ws, 'site', 'index.html'), '<h1>v2</h1>');
    await writeFile(join(ws, 'site', 'extra.html'), '<p>extra</p>');
    const cp2 = await createCheckpoint(ws, 'Zweite Seite');

    // Dirty state that must not be lost during the restore.
    await writeFile(join(ws, 'site', 'index.html'), '<h1>ungespeichert</h1>');

    const restored = await restoreCheckpoint(ws, cp1.id);

    // Old state is back — including deleting files added later.
    expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
    expect(existsSync(join(ws, 'site', 'extra.html'))).toBe(false);

    // HEAD has advanced (new commit, no history rewrite).
    expect(restored.id).toMatch(FULL_SHA);
    expect(restored.id).not.toBe(cp1.id);
    expect(restored.id).not.toBe(cp2.id);
    expect(restored.message).toBe(`Restored: ${cp1.id.slice(0, 7)}`);
    expect(await currentSha(ws)).toBe(restored.id);

    // Linear & lossless: auto-checkpoint before it, old checkpoints preserved.
    const list = await listCheckpoints(ws);
    expect(list[0]?.id).toBe(restored.id);
    expect(list[1]?.message).toBe('Automatic checkpoint before restore');
    expect(list.map((c) => c.id)).toContain(cp1.id);
    expect(list.map((c) => c.id)).toContain(cp2.id);

    // No detached HEAD, working directory clean.
    expect(await headRef(ws)).toBe('ref: refs/heads/main');
    expect(await isClean(ws)).toBe(true);

    // Restoring forward brings back v2 along with extra.html — and without
    // dirty state there is no further auto-checkpoint.
    const restored2 = await restoreCheckpoint(ws, cp2.id);
    expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v2</h1>');
    expect(existsSync(join(ws, 'site', 'extra.html'))).toBe(true);
    const list2 = await listCheckpoints(ws);
    expect(list2[0]?.id).toBe(restored2.id);
    expect(list2[1]?.id).toBe(restored.id);
  });

  it('restore uses the version name and accepts short SHAs', async () => {
    await initWorkspace(ws);
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>v1</h1>');
    const cp1 = await createCheckpoint(ws, 'Erste Seite');
    await nameVersion(ws, cp1.id, 'Startversion');

    await writeFile(join(ws, 'site', 'index.html'), '<h1>v2</h1>');
    await createCheckpoint(ws, 'Zweite Seite');

    // Restore via short SHA; label comes from the annotated tag.
    const restored = await restoreCheckpoint(ws, cp1.id.slice(0, 7));
    expect(restored.message).toBe('Restored: Startversion');
    expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
  });

  it('throws clear errors for unknown checkpoint and missing repo', async () => {
    await initWorkspace(ws);
    await expect(restoreCheckpoint(ws, 'deadbeef')).rejects.toThrow(/does not exist in this project/);

    const empty = await makeWorkspace('wab-versioning-kein-repo-');
    try {
      await expect(listCheckpoints(empty)).rejects.toThrow(/Versioning is not set up/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('Backend compatibility', () => {
  afterEach(() => {
    delete process.env['WAB_GIT_BACKEND'];
  });

  it('isomorphic-git reads and extends a repo created with system git', async () => {
    const ws = await makeWorkspace('wab-versioning-mixed-');
    try {
      process.env['WAB_GIT_BACKEND'] = 'system';
      await initWorkspace(ws);
      await mkdir(join(ws, 'site'), { recursive: true });
      await writeFile(join(ws, 'site', 'index.html'), '<h1>v1</h1>');
      const cp = await createCheckpoint(ws, 'Erste Seite', {
        turnId: 'turn-9',
        backend: 'byok',
        costUsd: 0.01,
      });
      await nameVersion(ws, cp.id, 'Startversion');

      process.env['WAB_GIT_BACKEND'] = 'isomorphic';
      const list = await listCheckpoints(ws);
      expect(list[0]?.id).toBe(cp.id);
      expect(list[0]?.turnId).toBe('turn-9');
      expect(list[0]?.backend).toBe('byok');
      expect(list[0]?.costUsd).toBeCloseTo(0.01, 6);
      expect(list[0]?.versionName).toBe('Startversion');

      await writeFile(join(ws, 'site', 'index.html'), '<h1>v2</h1>');
      await createCheckpoint(ws, 'Zweite Seite');
      const restored = await restoreCheckpoint(ws, cp.id);
      expect(restored.message).toBe('Restored: Startversion');
      expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
