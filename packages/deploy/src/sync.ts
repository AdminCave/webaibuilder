/**
 * Sync-Engine: der gemeinsame Delta-Deploy (PLAN §4). Reihenfolge für
 * Fast-Atomarität auf dummen Hosts:
 *   Verzeichnisse anlegen → Uploads → Deletes → Manifest ZULETZT.
 * Sowohl `deploy` als auch `rollback` laufen hierüber (rollback nur mit einem
 * anderen, aus git materialisierten Quellverzeichnis).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DeployTarget } from '@webaibuilder/core';

import { FtpTransport } from './ftpTransport';
import { buildManifest, diffManifest, hashLocalTree, parseManifest } from './manifest';
import { SftpTransport } from './sftpTransport';
import {
  ancestorDirsOf,
  describeError,
  normalizeRoot,
  remoteJoin,
  type Transport,
} from './transport';
import {
  MANIFEST_FILENAME,
  type DeployCredentials,
  type DeployManifest,
  type DeployProgress,
  type DeployResult,
} from './types';

/** Wählt den Transport anhand des Protokolls (PLAN §4). */
export function createTransport(target: DeployTarget, credentials: DeployCredentials): Transport {
  switch (target.protocol) {
    case 'sftp':
      return new SftpTransport(target, credentials);
    case 'ftp':
    case 'ftps':
      return new FtpTransport(target, credentials);
  }
}

/** Liest das Remote-Manifest aus dem Zielverzeichnis (null, wenn keins da ist). */
export async function readRemoteManifest(
  transport: Transport,
  root: string,
): Promise<DeployManifest | null> {
  const buf = await transport.readFile(remoteJoin(root, MANIFEST_FILENAME));
  if (!buf) return null;
  return parseManifest(buf.toString('utf8'));
}

/** Verbindet und mappt Verbindungsfehler auf eine klare deutsche Meldung. */
export async function connectOrThrow(transport: Transport): Promise<void> {
  try {
    await transport.connect();
  } catch (err) {
    throw new Error(describeError(err, 'Verbindung fehlgeschlagen'), { cause: err });
  }
}

/**
 * Führt den Delta-Deploy von `siteDir` (Stand `commitSha`) gegen ein bereits
 * verbundenes Ziel aus. Verbindung/Trennung managt der Aufrufer.
 */
export async function syncDir(
  transport: Transport,
  remoteRoot: string,
  siteDir: string,
  commitSha: string,
  onProgress?: DeployProgress,
): Promise<DeployResult> {
  const emit: DeployProgress = onProgress ?? (() => {});
  const root = normalizeRoot(remoteRoot);

  emit({ type: 'planning' });
  const local = await hashLocalTree(siteDir);
  const remoteManifest = await readRemoteManifest(transport, root);
  const plan = diffManifest(local, remoteManifest?.files ?? {});

  // 1) Verzeichnisse anlegen (Eltern vor Kind). Root nur, wenn nicht trivial.
  const dirs = ancestorDirsOf(plan.uploads);
  emit({ type: 'ensuring-dirs', total: dirs.length });
  if (root !== '/' && root !== '.') {
    await transport.ensureDir(root);
  }
  for (const relDir of dirs) {
    await transport.ensureDir(remoteJoin(root, relDir));
  }

  // 2) Uploads (neu/geändert).
  let bytesUploaded = 0;
  const uploadTotal = plan.uploads.length;
  for (let i = 0; i < uploadTotal; i += 1) {
    const rel = plan.uploads[i] as string;
    const data = await readFile(join(siteDir, rel));
    await transport.uploadFile(remoteJoin(root, rel), data);
    bytesUploaded += data.byteLength;
    emit({ type: 'uploading', path: rel, index: i + 1, total: uploadTotal });
  }

  // 3) Deletes (nur noch remote vorhanden).
  const deleteTotal = plan.deletes.length;
  for (let i = 0; i < deleteTotal; i += 1) {
    const rel = plan.deletes[i] as string;
    await transport.deleteFile(remoteJoin(root, rel));
    emit({ type: 'deleting', path: rel, index: i + 1, total: deleteTotal });
  }

  // 4) Manifest ZULETZT (Fast-Atomarität: erst wenn alles oben stand).
  const manifest = buildManifest(commitSha, local);
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  await transport.writeFile(remoteJoin(root, MANIFEST_FILENAME), manifestBytes);
  emit({ type: 'manifest-written', commit: commitSha });

  const result: DeployResult = {
    commit: commitSha,
    uploaded: plan.uploads.length,
    deleted: plan.deletes.length,
    unchanged: plan.unchangedCount,
    bytesUploaded,
    plan,
  };
  emit({ type: 'done', result });
  return result;
}

/**
 * Voller Lebenszyklus: verbinden → syncDir → trennen. Fehler werden in klare
 * deutsche Meldungen übersetzt und als `error`-Progress-Event gemeldet, bevor
 * sie geworfen werden. Credentials landen NIE in Meldung oder Log.
 */
export async function syncToTarget(
  target: DeployTarget,
  credentials: DeployCredentials,
  siteDir: string,
  commitSha: string,
  onProgress?: DeployProgress,
): Promise<DeployResult> {
  const emit: DeployProgress = onProgress ?? (() => {});
  const transport = createTransport(target, credentials);
  emit({ type: 'connecting' });
  try {
    await connectOrThrow(transport);
    return await syncDir(transport, target.remotePath, siteDir, commitSha, emit);
  } catch (err) {
    const message = err instanceof Error ? err.message : describeError(err, 'Deploy');
    emit({ type: 'error', message });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    await transport.disconnect();
  }
}
