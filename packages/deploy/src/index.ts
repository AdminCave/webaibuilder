/**
 * Deploy-Engine (PLAN §4, das Herzstück): Hash-Manifest-Sync über
 * ssh2-sftp-client (SFTP) / basic-ftp (FTP/FTPS inkl. TLS-Session-Reuse),
 * Rollback, Preflight. Reihenfolge für Fast-Atomarität:
 * Verzeichnisse → Uploads → Deletes → Manifest zuletzt.
 *
 * Credentials kommen aus dem OS-Schlüsselbund (@napi-rs/keyring) — dieses
 * Paket erhält Secrets nur zur Laufzeit, speichert oder loggt sie nie.
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
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

/** Eindeutiges Probe-Verzeichnis der Preflight-Capability-Probe. */
const PREFLIGHT_PROBE_DIR = `.wab-preflight-${process.pid}`;

/**
 * Verbindungstest + Capability-Probe gegen ein Deploy-Ziel (PLAN §4):
 * Auth prüfen, Zielverzeichnis auf Existenz/Schreibbarkeit testen, mkdir-
 * rekursiv & rename (RNTO) proben, vorhandenes Manifest + dessen SHA lesen.
 * Wirft NICHT bei Verbindungs-/Auth-Fehlern, sondern liefert sie strukturiert
 * (deutsch, Du-Form) zurück — die UI zeigt sie an.
 *
 * TODO(M3-Betrieb): Test-Matrix Hetzner, IONOS, all-inkl, Strato, Netcup.
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
      failures.push(describeError(err, 'Verbindung fehlgeschlagen'));
      return { ok: false, messages, failures, capabilities, remoteManifest: null, remoteSha: null };
    }
    messages.push('Verbindung steht — die Anmeldung hat geklappt.');

    if (transport.tlsSessionReuse !== undefined) {
      capabilities.tlsSessionReuse = transport.tlsSessionReuse;
    }

    // Zielverzeichnis erreichbar?
    try {
      await transport.list(root);
      messages.push(`Das Zielverzeichnis „${root}" ist erreichbar.`);
    } catch (err) {
      failures.push(describeError(err, `Zielverzeichnis „${root}"`));
    }

    // Schreibbarkeit + Capabilities proben (in ein eigenes Probe-Verzeichnis).
    await probeCapabilities(transport, root, capabilities, messages, failures);

    // Vorhandenes Manifest + dessen SHA (Drift-/„Deployed"-Anzeige).
    let remoteManifest: DeployManifest | null = null;
    let remoteSha: string | null = null;
    try {
      remoteManifest = await readRemoteManifest(transport, root);
      remoteSha = remoteManifest?.commit ?? null;
      messages.push(
        remoteSha
          ? `Aktuell deployt: ${remoteSha.slice(0, 7)}.`
          : 'Auf dem Ziel liegt noch kein von uns deployter Stand.',
      );
    } catch {
      messages.push('Ein vorhandenes Manifest ließ sich nicht lesen — es wird bei Bedarf neu erstellt.');
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

/** Schreibtest + mkdir-rekursiv- und rename-Probe; räumt hinterher auf. */
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
    messages.push('Das Zielverzeichnis ist beschreibbar.');

    // rename/RNTO nur proben und erfassen — v1 verlässt sich nicht darauf.
    try {
      const renamed = remoteJoin(probeRoot, 'probe2.txt');
      await transport.rename(probeFile, renamed);
      capabilities.rename = true;
    } catch {
      capabilities.rename = false;
    }
  } catch (err) {
    failures.push(describeError(err, 'Schreibtest im Zielverzeichnis'));
  } finally {
    try {
      await transport.removeDir(probeRoot);
    } catch {
      // Cleanup ist best-effort — ein zurückbleibendes Probe-Verzeichnis
      // ist unschön, aber kein Fehlerfall für den Nutzer.
    }
  }
}

/**
 * Reiner Diff (kein Netz): lokaler Hash-Baum von `siteDir` vs. Remote-Manifest.
 * Nützlich für Vorschau/Tests; der eigentliche Deploy nutzt denselben Diff.
 */
export async function planDeploy(
  siteDir: string,
  remoteManifest: DeployManifest | null,
): Promise<DeployPlan> {
  const local = await hashLocalTree(siteDir);
  return diffManifest(local, remoteManifest?.files ?? {});
}

/**
 * Deployt `siteDir` (Stand `commitSha`) auf das Ziel: Hash-Manifest-Sync mit
 * Reihenfolge Verzeichnisse → Uploads → Deletes → Manifest zuletzt.
 * Fortschritt kommt file-by-file über `onProgress`.
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
 * Rollback (PLAN §4): den `site/`-Baum von `toCommitSha` aus git in ein Temp-
 * Verzeichnis materialisieren und denselben Delta-Sync fahren — es bewegt sich
 * nur das Delta. Funktioniert auf jedem Host, ohne serverseitige Historie.
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
 * Drift-Erkennung ohne Netz: vergleicht die von der Registry erwartete SHA mit
 * der SHA aus einem (schon gelesenen) Remote-Manifest.
 */
export function compareDrift(
  expectedSha: string,
  remoteSha: string | null,
): DriftResult {
  return { drift: expectedSha !== remoteSha, expectedSha, remoteSha };
}

/**
 * Drift-Erkennung mit Verbindung (PLAN §4, „Drift beim Verbinden"): liest das
 * Remote-Manifest und vergleicht dessen SHA mit dem, was die Registry für
 * deployt hält. Liefert Match/Drift + die tatsächliche Remote-SHA.
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
