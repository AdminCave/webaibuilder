/**
 * Hash-Manifest: lokaler SHA-256-Baum über `site/` und Diff gegen das
 * Remote-Manifest (`.wab-manifest.json`). Muster: SamKirkland/FTP-Deploy-Action
 * — nur neue/geänderte Dateien hoch, nur remote-only Dateien weg (PLAN §4).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MANIFEST_FILENAME, type DeployManifest, type DeployPlan } from './types';

/** VCS-/Werkzeug-Rauschen, das nie mit-deployt wird. */
const IGNORED_NAMES = new Set(['.git', '.wab-tmp', MANIFEST_FILENAME]);

/** SHA-256 (hex) eines Puffers — der Inhaltsschlüssel im Manifest. */
export function hashBuffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Baut den lokalen Hash-Baum von `siteDir`: relativer POSIX-Pfad → SHA-256.
 * Überspringt nur VCS-/Werkzeug-Rauschen (kein Inhalt wird still verworfen).
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
      // Symlinks u. Ä. werden bewusst ignoriert (statische Seiten haben keine).
    }
  }

  await walk(siteDir, '');
  return tree;
}

/** Erzeugt das Manifest-Objekt für den gerade deployten Stand. */
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
 * Parst ein Remote-Manifest defensiv. Bei fehlendem/kaputtem Manifest → null
 * (führt zu Voll-Upload — der sichere Fallback auf einem dummen Host).
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
 * Diff lokaler Hash-Baum ⟷ Remote-Manifest → minimale Upload/Delete-Ops.
 * - Upload: Datei fehlt remote oder Hash weicht ab.
 * - Delete: Datei liegt nur im Remote-Manifest.
 * Pfade werden deterministisch sortiert (stabile UI, stabile Tests).
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
