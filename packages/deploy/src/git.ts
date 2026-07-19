/**
 * Rollback materialization (PLAN §4): write the `site/` tree of any commit
 * into a temp directory — purely via isomorphic-git, without touching the
 * working directory and without server-side history. Afterwards the same
 * delta upload runs as with a normal deploy.
 *
 * We deliberately do NOT edit packages/versioning (by requirement); the git
 * plumbing here is limited to materializing a tree.
 */

import nodeFs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import git from 'isomorphic-git';

import { SITE_DIRNAME } from '@webaibuilder/core';

const SITE_PREFIX = `${SITE_DIRNAME}/`;

/**
 * Writes the `site/` subtree of `commitSha` into a fresh temp directory and
 * returns its path. The caller cleans up via {@link removeTempDir}.
 */
export async function materializeSiteTree(
  workspaceDir: string,
  commitSha: string,
): Promise<string> {
  const dest = await mkdtemp(join(tmpdir(), 'wab-rollback-'));

  // All blob paths in the target commit; we only materialize the site/ subtree.
  const allFiles = await git.listFiles({ fs: nodeFs, dir: workspaceDir, ref: commitSha });
  const filepaths = allFiles.filter((filepath) => filepath.startsWith(SITE_PREFIX));

  for (const filepath of filepaths) {
    const { blob } = await git.readBlob({
      fs: nodeFs,
      dir: workspaceDir,
      oid: commitSha,
      filepath,
    });
    const rel = filepath.slice(SITE_PREFIX.length);
    const abs = join(dest, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from(blob));
  }

  return dest;
}

/** Cleans up a temp directory created by {@link materializeSiteTree}. */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
