/**
 * Round-trip-Tests für die Versionierung: init → checkpoint → list → name →
 * restore, für BEIDE Backends (system-git via simple-git, isomorphic-git).
 * Backend wird pro Suite über WAB_GIT_BACKEND erzwungen.
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

/** Backend-neutraler Clean-Check über isomorphic-git (liest jedes git-Repo). */
async function isClean(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs: nodeFs, dir });
  return matrix.every(([, head, workdir, stage]) => head === 1 && workdir === 1 && stage === 1);
}

/** Inhalt von .git/HEAD — "ref: refs/heads/main" = auf Branch, nicht detached. */
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

  it('initWorkspace legt Repo, .gitignore und Erst-Commit an (idempotent)', async () => {
    await initWorkspace(ws);

    expect(existsSync(join(ws, '.git'))).toBe(true);
    const gitignore = await readFile(join(ws, '.gitignore'), 'utf8');
    expect(gitignore).toContain('project.json');

    const list = await listCheckpoints(ws);
    expect(list).toHaveLength(1);
    expect(list[0]?.message).toBe('Projekt angelegt');
    expect(await headRef(ws)).toBe('ref: refs/heads/main');
    expect(await isClean(ws)).toBe(true);

    // Zweiter Aufruf ändert nichts.
    await initWorkspace(ws);
    expect(await listCheckpoints(ws)).toHaveLength(1);
  });

  it('createCheckpoint committet alles und liest Trailer-Metadaten zurück', async () => {
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

    // Round-trip über git log (neueste zuerst).
    const list = await listCheckpoints(ws);
    expect(list[0]?.id).toBe(cp.id);
    expect(list[0]?.message).toBe('Bau mir eine Vereinsseite');
    expect(list[0]?.turnId).toBe('turn-1');
    expect(list[0]?.backend).toBe('claude-sdk');
    expect(list[0]?.sessionId).toBe('sess-abc');
    expect(list[0]?.costUsd).toBeCloseTo(0.0421, 6);
    expect(list[1]?.message).toBe('Projekt angelegt');

    expect(await isClean(ws)).toBe(true);
    expect(await currentSha(ws)).toBe(cp.id);
  });

  it('ignoriert project.json (App-Metadaten sind nicht Teil der Checkpoints)', async () => {
    await initWorkspace(ws);
    await writeFile(join(ws, 'project.json'), '{"id":"p1"}');
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>Test</h1>');
    await createCheckpoint(ws, 'Erste Seite');

    const tracked = await git.listFiles({ fs: nodeFs, dir: ws, ref: 'HEAD' });
    expect(tracked).toContain('site/index.html');
    expect(tracked).not.toContain('project.json');
  });

  it('nameVersion erstellt annotated Tag; listCheckpoints liefert versionName', async () => {
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

    // Namenskollision → eindeutiger Tag-Name.
    const named2 = await nameVersion(ws, cp.id, 'Schöne Startversion');
    expect(named2.tagName).toBe('wab/schoene-startversion-2');
  });

  it('restore = neuer Commit: linear, verlustfrei, kein detached HEAD', async () => {
    await initWorkspace(ws);
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>v1</h1>');
    const cp1 = await createCheckpoint(ws, 'Erste Seite');

    await writeFile(join(ws, 'site', 'index.html'), '<h1>v2</h1>');
    await writeFile(join(ws, 'site', 'extra.html'), '<p>extra</p>');
    const cp2 = await createCheckpoint(ws, 'Zweite Seite');

    // Dirty state, der beim Restore nicht verloren gehen darf.
    await writeFile(join(ws, 'site', 'index.html'), '<h1>ungespeichert</h1>');

    const restored = await restoreCheckpoint(ws, cp1.id);

    // Alter Stand ist zurück — inkl. Löschen später hinzugekommener Dateien.
    expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
    expect(existsSync(join(ws, 'site', 'extra.html'))).toBe(false);

    // HEAD ist vorgerückt (neuer Commit, keine History-Umschreibung).
    expect(restored.id).toMatch(FULL_SHA);
    expect(restored.id).not.toBe(cp1.id);
    expect(restored.id).not.toBe(cp2.id);
    expect(restored.message).toBe(`Wiederhergestellt: ${cp1.id.slice(0, 7)}`);
    expect(await currentSha(ws)).toBe(restored.id);

    // Linear & verlustfrei: Auto-Checkpoint davor, alte Checkpoints erhalten.
    const list = await listCheckpoints(ws);
    expect(list[0]?.id).toBe(restored.id);
    expect(list[1]?.message).toBe('Automatischer Checkpoint vor Wiederherstellung');
    expect(list.map((c) => c.id)).toContain(cp1.id);
    expect(list.map((c) => c.id)).toContain(cp2.id);

    // Kein detached HEAD, Arbeitsverzeichnis sauber.
    expect(await headRef(ws)).toBe('ref: refs/heads/main');
    expect(await isClean(ws)).toBe(true);

    // Vorwärts wiederherstellen holt v2 samt extra.html zurück — und ohne
    // dirty state gibt es keinen weiteren Auto-Checkpoint.
    const restored2 = await restoreCheckpoint(ws, cp2.id);
    expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v2</h1>');
    expect(existsSync(join(ws, 'site', 'extra.html'))).toBe(true);
    const list2 = await listCheckpoints(ws);
    expect(list2[0]?.id).toBe(restored2.id);
    expect(list2[1]?.id).toBe(restored.id);
  });

  it('restore nutzt den Versionsnamen und akzeptiert Kurz-SHAs', async () => {
    await initWorkspace(ws);
    await mkdir(join(ws, 'site'), { recursive: true });
    await writeFile(join(ws, 'site', 'index.html'), '<h1>v1</h1>');
    const cp1 = await createCheckpoint(ws, 'Erste Seite');
    await nameVersion(ws, cp1.id, 'Startversion');

    await writeFile(join(ws, 'site', 'index.html'), '<h1>v2</h1>');
    await createCheckpoint(ws, 'Zweite Seite');

    // Restore per Kurz-SHA; Label kommt aus dem annotated Tag.
    const restored = await restoreCheckpoint(ws, cp1.id.slice(0, 7));
    expect(restored.message).toBe('Wiederhergestellt: Startversion');
    expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
  });

  it('wirft verständliche Fehler bei unbekanntem Checkpoint und fehlendem Repo', async () => {
    await initWorkspace(ws);
    await expect(restoreCheckpoint(ws, 'deadbeef')).rejects.toThrow(/gibt es in diesem Projekt nicht/);

    const empty = await makeWorkspace('wab-versioning-kein-repo-');
    try {
      await expect(listCheckpoints(empty)).rejects.toThrow(/keine Versionierung/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('Backend-Kompatibilität', () => {
  afterEach(() => {
    delete process.env['WAB_GIT_BACKEND'];
  });

  it('isomorphic-git liest und erweitert ein mit System-git erstelltes Repo', async () => {
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
      expect(restored.message).toBe('Wiederhergestellt: Startversion');
      expect(await readFile(join(ws, 'site', 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
