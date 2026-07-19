/**
 * Deploy engine (PLAN §4, the core): hash-manifest sync via
 * ssh2-sftp-client (SFTP) / basic-ftp (FTP/FTPS incl. TLS session reuse),
 * rollback, preflight. Order for fast atomicity:
 * directories → uploads → deletes → manifest last.
 *
 * Credentials come from the OS keychain (@napi-rs/keyring) — this
 * package receives secrets only at runtime and never stores or logs them.
 * Electron-free — this package must never import `electron`.
 */

import type { DeployTarget } from '@webaibuilder/core';

import { materializeSiteTree, removeTempDir } from './git';
import { diffManifest, hashLocalTree } from './manifest';
import {
  connectOrThrow,
  createTransport,
  readRemoteManifest,
  syncDir,
  syncToTarget,
} from './sync';
import { describeError, normalizeRoot, remoteJoin, type Transport } from './transport';
import {
  type DeployCapabilities,
  type DeployCredentials,
  type DeployManifest,
  type DeployOptions,
  type DeployPlan,
  type DeployResult,
  type DriftResult,
  type PreflightResult,
  type RollbackOptions,
} from './types';

export {
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  type DeployCapabilities,
  type DeployCredentials,
  type DeployManifest,
  type DeployOptions,
  type DeployPlan,
  type DeployProgress,
  type DeployProgressEvent,
  type DeployResult,
  type DriftResult,
  type PreflightResult,
  type RollbackOptions,
} from './types';

/** Unique probe directory for the preflight capability probe. */
const PREFLIGHT_PROBE_DIR = `.wab-preflight-${process.pid}`;

/**
 * Connection test + capability probe against a deploy target (PLAN §4):
 * check auth, test the target directory for existence/writability, probe
 * recursive mkdir & rename (RNTO), read an existing manifest + its SHA.
 * Does NOT throw on connection/auth errors, but returns them in a structured
 * form — the UI displays them.
 *
 * TODO(M3-operations): test matrix Hetzner, IONOS, all-inkl, Strato, Netcup.
 */
export async function preflight(
  target: DeployTarget,
  credentials: DeployCredentials,
): Promise<PreflightResult> {
  const messages: string[] = [];
  const failures: string[] = [];
  const capabilities: DeployCapabilities = { mkdirRecursive: false, rename: false };
  const root = normalizeRoot(target.remotePath);
  const transport = createTransport(target, credentials);

  try {
    try {
      await transport.connect();
    } catch (err) {
      failures.push(describeError(err, 'Connection failed'));
      return { ok: false, messages, failures, capabilities, remoteManifest: null, remoteSha: null };
    }
    messages.push('Connection established — authentication succeeded.');

    if (transport.tlsSessionReuse !== undefined) {
      capabilities.tlsSessionReuse = transport.tlsSessionReuse;
    }

    // Target directory reachable?
    try {
      await transport.list(root);
      messages.push(`The target directory "${root}" is reachable.`);
    } catch (err) {
      failures.push(describeError(err, `Target directory "${root}"`));
    }

    // Probe writability + capabilities (into a dedicated probe directory).
    await probeCapabilities(transport, root, capabilities, messages, failures);

    // Existing manifest + its SHA (drift / "deployed" display).
    let remoteManifest: DeployManifest | null = null;
    let remoteSha: string | null = null;
    try {
      remoteManifest = await readRemoteManifest(transport, root);
      remoteSha = remoteManifest?.commit ?? null;
      messages.push(
        remoteSha
          ? `Currently deployed: ${remoteSha.slice(0, 7)}.`
          : 'No state deployed by us exists on the target yet.',
      );
    } catch {
      messages.push('An existing manifest could not be read — it will be recreated if needed.');
    }

    return {
      ok: failures.length === 0,
      messages,
      failures,
      capabilities,
      remoteManifest,
      remoteSha,
    };
  } finally {
    await transport.disconnect();
  }
}

/** Write test + recursive-mkdir and rename probe; cleans up afterwards. */
async function probeCapabilities(
  transport: Transport,
  root: string,
  capabilities: DeployCapabilities,
  messages: string[],
  failures: string[],
): Promise<void> {
  const probeRoot = remoteJoin(root, PREFLIGHT_PROBE_DIR);
  const nested = remoteJoin(probeRoot, 'a/b');
  const probeFile = remoteJoin(probeRoot, 'probe.txt');
  try {
    await transport.ensureDir(nested);
    capabilities.mkdirRecursive = true;

    await transport.uploadFile(probeFile, Buffer.from('wab-preflight'));
    messages.push('The target directory is writable.');

    // Only probe and record rename/RNTO — v1 does not rely on it.
    try {
      const renamed = remoteJoin(probeRoot, 'probe2.txt');
      await transport.rename(probeFile, renamed);
      capabilities.rename = true;
    } catch {
      capabilities.rename = false;
    }
  } catch (err) {
    failures.push(describeError(err, 'Write test in the target directory'));
  } finally {
    try {
      await transport.removeDir(probeRoot);
    } catch {
      // Cleanup is best-effort — a leftover probe directory is
      // unsightly, but not an error case for the user.
    }
  }
}

/**
 * Pure diff (no network): local hash tree of `siteDir` vs. remote manifest.
 * Useful for preview/tests; the actual deploy uses the same diff.
 */
export async function planDeploy(
  siteDir: string,
  remoteManifest: DeployManifest | null,
): Promise<DeployPlan> {
  const local = await hashLocalTree(siteDir);
  return diffManifest(local, remoteManifest?.files ?? {});
}

/**
 * Deploys `siteDir` (state `commitSha`) to the target: hash-manifest sync with
 * order directories → uploads → deletes → manifest last.
 * Progress arrives file-by-file via `onProgress`.
 */
export async function deploy(
  target: DeployTarget,
  credentials: DeployCredentials,
  options: DeployOptions,
): Promise<DeployResult> {
  return syncToTarget(
    target,
    credentials,
    options.siteDir,
    options.commitSha,
    options.onProgress,
  );
}

/**
 * Rollback (PLAN §4): materialize the `site/` tree of `toCommitSha` from git
 * into a temp directory and run the same delta sync — only the delta moves.
 * Works on any host, without server-side history.
 */
export async function rollback(
  target: DeployTarget,
  credentials: DeployCredentials,
  options: RollbackOptions,
): Promise<DeployResult> {
  const emit = options.onProgress ?? (() => {});
  let tempDir: string | undefined;
  const transport = createTransport(target, credentials);
  emit({ type: 'connecting' });
  try {
    tempDir = await materializeSiteTree(options.workspaceDir, options.toCommitSha);
    await connectOrThrow(transport);
    return await syncDir(transport, target.remotePath, tempDir, options.toCommitSha, emit);
  } catch (err) {
    const message = err instanceof Error ? err.message : describeError(err, 'Rollback');
    emit({ type: 'error', message });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    await transport.disconnect();
    if (tempDir) await removeTempDir(tempDir);
  }
}

/**
 * Drift detection without network: compares the SHA expected by the registry
 * with the SHA from an (already read) remote manifest.
 */
export function compareDrift(
  expectedSha: string,
  remoteSha: string | null,
): DriftResult {
  return { drift: expectedSha !== remoteSha, expectedSha, remoteSha };
}

/**
 * Drift detection with connection (PLAN §4, "drift on connect"): reads the
 * remote manifest and compares its SHA with what the registry considers
 * deployed. Returns match/drift + the actual remote SHA.
 */
export async function detectDrift(
  target: DeployTarget,
  credentials: DeployCredentials,
  expectedSha: string,
): Promise<DriftResult> {
  const transport = createTransport(target, credentials);
  const root = normalizeRoot(target.remotePath);
  try {
    await connectOrThrow(transport);
    const manifest = await readRemoteManifest(transport, root);
    return compareDrift(expectedSha, manifest?.commit ?? null);
  } finally {
    await transport.disconnect();
  }
}
