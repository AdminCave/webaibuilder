/**
 * Sicherheits-Tests für das Pfad-Containment (harte Anforderung, PLAN §4).
 * `resolveInSite` muss jeden Escape aus site/ verweigern — lexikalisch,
 * über absolute Pfade UND über Symlinks.
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PathEscapeError, resolveInSite } from '../src/paths';

let workspaceDir: string;
let siteDir: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'wab-paths-'));
  siteDir = join(workspaceDir, 'site');
  await mkdir(siteDir, { recursive: true });
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('resolveInSite (Containment)', () => {
  it('erlaubt normale Pfade innerhalb von site/', async () => {
    const abs = await resolveInSite(siteDir, 'index.html');
    expect(abs).toBe(join(siteDir, 'index.html'));
    const nested = await resolveInSite(siteDir, 'css/style.css');
    expect(nested).toBe(join(siteDir, 'css', 'style.css'));
  });

  it('verankert absolute Nutzerpfade an der Site-Wurzel', async () => {
    const abs = await resolveInSite(siteDir, '/index.html');
    expect(abs).toBe(join(siteDir, 'index.html'));
  });

  it('verweigert ".."-Escapes', async () => {
    await expect(resolveInSite(siteDir, '../evil.html')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(resolveInSite(siteDir, '../../etc/passwd')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(resolveInSite(siteDir, 'a/../../evil.html')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('verweigert Symlink-Escapes (realpath-Prüfung)', async () => {
    // Ein Symlink innerhalb site/, der auf das Elternverzeichnis zeigt.
    const outsideTarget = join(workspaceDir, 'secret');
    await mkdir(outsideTarget, { recursive: true });
    await writeFile(join(outsideTarget, 'leak.txt'), 'geheim', 'utf8');
    await symlink(outsideTarget, join(siteDir, 'link'), 'dir');

    await expect(resolveInSite(siteDir, 'link/leak.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('erlaubt einen Symlink, der innerhalb von site/ bleibt', async () => {
    const insideTarget = join(siteDir, 'real');
    await mkdir(insideTarget, { recursive: true });
    await symlink(insideTarget, join(siteDir, 'alias'), 'dir');
    const abs = await resolveInSite(siteDir, 'alias/page.html');
    expect(abs).toBe(join(insideTarget, 'page.html'));
  });
});
