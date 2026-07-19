/**
 * Hash manifest: local SHA-256 tree over `site/` and diff against the
 * remote manifest (`.wab-manifest.json`). Pattern: SamKirkland/FTP-Deploy-Action
 * — only upload new/changed files, only delete remote-only files (PLAN §4).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MANIFEST_FILENAME, type DeployManifest, type DeployPlan } from './types';

/** VCS/tooling noise that is never deployed. */
const IGNORED_NAMES = new Set(['.git', '.wab-tmp', MANIFEST_FILENAME]);

/** SHA-256 (hex) of a buffer — the content key in the manifest. */
export function hashBuffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Builds the local hash tree of `siteDir`: relative POSIX path → SHA-256.
 * Skips only VCS/tooling noise (no content is silently discarded).
 */
export async function hashLocalTree(siteDir: string): Promise<Map<string, string>> {
  const tree = new Map<string, string>();

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const data = await readFile(abs);
        tree.set(rel, hashBuffer(data));
      }
      // Symlinks and similar are deliberately ignored (static sites have none).
    }
  }

  await walk(siteDir, '');
  return tree;
}

/** Builds the manifest object for the just-deployed state. */
export function buildManifest(commit: string, tree: Map<string, string>): DeployManifest {
  const files: Record<string, string> = {};
  for (const key of [...tree.keys()].sort()) {
    files[key] = tree.get(key) as string;
  }
  return {
    version: 1,
    commit,
    generatedAt: new Date().toISOString(),
    files,
  };
}

/**
 * Parses a remote manifest defensively. On a missing/corrupt manifest → null
 * (leads to a full upload — the safe fallback on a dumb host).
 */
export function parseManifest(text: string): DeployManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 1) return null;
  if (typeof obj['commit'] !== 'string') return null;
  const filesRaw = obj['files'];
  if (typeof filesRaw !== 'object' || filesRaw === null) return null;
  const files: Record<string, string> = {};
  for (const [key, value] of Object.entries(filesRaw as Record<string, unknown>)) {
    if (typeof value === 'string') files[key] = value;
  }
  return {
    version: 1,
    commit: obj['commit'],
    generatedAt: typeof obj['generatedAt'] === 'string' ? obj['generatedAt'] : '',
    files,
  };
}

/**
 * Diff local hash tree ⟷ remote manifest → minimal upload/delete ops.
 * - Upload: file missing remotely or hash differs.
 * - Delete: file present only in the remote manifest.
 * Paths are sorted deterministically (stable UI, stable tests).
 */
export function diffManifest(
  local: Map<string, string>,
  remoteFiles: Record<string, string>,
): DeployPlan {
  const uploads: string[] = [];
  let unchangedCount = 0;
  for (const [rel, hash] of local) {
    if (remoteFiles[rel] === hash) {
      unchangedCount += 1;
    } else {
      uploads.push(rel);
    }
  }
  const deletes: string[] = [];
  for (const rel of Object.keys(remoteFiles)) {
    if (!local.has(rel)) deletes.push(rel);
  }
  uploads.sort();
  deletes.sort();
  return { uploads, deletes, unchangedCount };
}
