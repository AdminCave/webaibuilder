/**
 * Security tests for path containment (hard requirement, PLAN §4).
 * `resolveInSite` must deny every escape out of site/ — lexically, via absolute
 * paths AND via symlinks.
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

describe('resolveInSite (containment)', () => {
  it('allows normal paths within site/', async () => {
    const abs = await resolveInSite(siteDir, 'index.html');
    expect(abs).toBe(join(siteDir, 'index.html'));
    const nested = await resolveInSite(siteDir, 'css/style.css');
    expect(nested).toBe(join(siteDir, 'css', 'style.css'));
  });

  it('anchors absolute user paths at the site root', async () => {
    const abs = await resolveInSite(siteDir, '/index.html');
    expect(abs).toBe(join(siteDir, 'index.html'));
  });

  it('denies ".." escapes', async () => {
    await expect(resolveInSite(siteDir, '../evil.html')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(resolveInSite(siteDir, '../../etc/passwd')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(resolveInSite(siteDir, 'a/../../evil.html')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('denies symlink escapes (realpath check)', async () => {
    // A symlink inside site/ that points to the parent directory.
    const outsideTarget = join(workspaceDir, 'secret');
    await mkdir(outsideTarget, { recursive: true });
    await writeFile(join(outsideTarget, 'leak.txt'), 'geheim', 'utf8');
    await symlink(outsideTarget, join(siteDir, 'link'), 'dir');

    await expect(resolveInSite(siteDir, 'link/leak.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('allows a symlink that stays within site/', async () => {
    const insideTarget = join(siteDir, 'real');
    await mkdir(insideTarget, { recursive: true });
    await symlink(insideTarget, join(siteDir, 'alias'), 'dir');
    const abs = await resolveInSite(siteDir, 'alias/page.html');
    expect(abs).toBe(join(insideTarget, 'page.html'));
  });
});
