/**
 * Sync engine: the shared delta deploy (PLAN §4). Order for
 * fast atomicity on dumb hosts:
 *   create directories → uploads → deletes → manifest LAST.
 * Both `deploy` and `rollback` run through this (rollback only with a
 * different source directory materialized from git).
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

/** Selects the transport based on the protocol (PLAN §4). */
export function createTransport(target: DeployTarget, credentials: DeployCredentials): Transport {
  switch (target.protocol) {
    case 'sftp':
      return new SftpTransport(target, credentials);
    case 'ftp':
    case 'ftps':
      return new FtpTransport(target, credentials);
  }
}

/** Reads the remote manifest from the target directory (null if none exists). */
export async function readRemoteManifest(
  transport: Transport,
  root: string,
): Promise<DeployManifest | null> {
  const buf = await transport.readFile(remoteJoin(root, MANIFEST_FILENAME));
  if (!buf) return null;
  return parseManifest(buf.toString('utf8'));
}

/** Connects and maps connection errors to a clear message. */
export async function connectOrThrow(transport: Transport): Promise<void> {
  try {
    await transport.connect();
  } catch (err) {
    throw new Error(describeError(err, 'Connection failed'), { cause: err });
  }
}

/**
 * Runs the delta deploy of `siteDir` (state `commitSha`) against an already
 * connected target. Connection/disconnection is managed by the caller.
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

  // 1) Create directories (parents before children). Root only if non-trivial.
  const dirs = ancestorDirsOf(plan.uploads);
  emit({ type: 'ensuring-dirs', total: dirs.length });
  if (root !== '/' && root !== '.') {
    await transport.ensureDir(root);
  }
  for (const relDir of dirs) {
    await transport.ensureDir(remoteJoin(root, relDir));
  }

  // 2) Uploads (new/changed).
  let bytesUploaded = 0;
  const uploadTotal = plan.uploads.length;
  for (let i = 0; i < uploadTotal; i += 1) {
    const rel = plan.uploads[i] as string;
    const data = await readFile(join(siteDir, rel));
    await transport.uploadFile(remoteJoin(root, rel), data);
    bytesUploaded += data.byteLength;
    emit({ type: 'uploading', path: rel, index: i + 1, total: uploadTotal });
  }

  // 3) Deletes (present only remotely now).
  const deleteTotal = plan.deletes.length;
  for (let i = 0; i < deleteTotal; i += 1) {
    const rel = plan.deletes[i] as string;
    await transport.deleteFile(remoteJoin(root, rel));
    emit({ type: 'deleting', path: rel, index: i + 1, total: deleteTotal });
  }

  // 4) Manifest LAST (fast atomicity: only once everything above is in place).
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
 * Full lifecycle: connect → syncDir → disconnect. Errors are translated into
 * clear messages and reported as an `error` progress event before
 * they are thrown. Credentials NEVER end up in a message or log.
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
