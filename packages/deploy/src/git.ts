/**
 * Rollback-Materialisierung (PLAN §4): den `site/`-Baum eines beliebigen
 * Commits in ein Temp-Verzeichnis schreiben — rein über isomorphic-git, ohne
 * das Arbeitsverzeichnis anzufassen und ohne serverseitige Historie. Danach
 * läuft derselbe Delta-Upload wie beim normalen Deploy.
 *
 * Wir editieren packages/versioning bewusst NICHT (Vorgabe); die git-Plumbing
 * hier ist auf das Materialisieren eines Trees beschränkt.
 */

import nodeFs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import git from 'isomorphic-git';

import { SITE_DIRNAME } from '@webaibuilder/core';

const SITE_PREFIX = `${SITE_DIRNAME}/`;

/**
 * Schreibt den `site/`-Teilbaum von `commitSha` in ein frisches Temp-Verzeichnis
 * und liefert dessen Pfad. Der Aufrufer räumt mit {@link removeTempDir} auf.
 */
export async function materializeSiteTree(
  workspaceDir: string,
  commitSha: string,
): Promise<string> {
  const dest = await mkdtemp(join(tmpdir(), 'wab-rollback-'));

  // Alle Blob-Pfade im Ziel-Commit; wir materialisieren nur den site/-Teilbaum.
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

/** Räumt ein per {@link materializeSiteTree} erzeugtes Temp-Verzeichnis auf. */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
