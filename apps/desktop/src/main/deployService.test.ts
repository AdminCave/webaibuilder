/**
 * Headless tests of the deploy orchestration. The real deploy engine (transport)
 * is replaced by a fake (no server needed — the deploy package already
 * round-trip-tests the transport itself). Registry and keychain are real
 * (temporary DB) resp. a fake; currentSha, time, and push emitter are injected.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeployTarget } from '@webaibuilder/core';
import type { DeployResult, DriftResult, PreflightResult } from '@webaibuilder/deploy';

import type { DeployProgressMessage, DeployTargetsMessage } from '../shared/channels';
import type { DeployTargetInput } from '../shared/deploy';
import { DeployHistoryStore } from './deployHistory';
import { realDeployEngine } from './deployEngine';
import { DeployService, type DeployEngine } from './deployService';
import { DeployTargetService, type DeploySecretsPort } from './deployTargets';
import { SqliteProjectRegistry } from './registry';

const TEMPLATES_ROOT = fileURLToPath(new URL('../../resources/templates', import.meta.url));

function fakeSecrets(): DeploySecretsPort {
  const store = new Map<string, string>();
  return {
    setSecret: (kind, id, value) => {
      store.set(`${kind}:${id}`, value);
    },
    getSecret: (kind, id) => store.get(`${kind}:${id}`) ?? null,
    deleteSecret: (kind, id) => store.delete(`${kind}:${id}`),
    hasSecret: (kind, id) => {
      const v = store.get(`${kind}:${id}`);
      return v !== undefined && v !== '';
    },
  };
}

function targetInput(overrides: Partial<DeployTargetInput> = {}): DeployTargetInput {
  return {
    name: 'IONOS',
    protocol: 'sftp',
    host: 'ssh.example.org',
    port: 22,
    username: 'w012345',
    remotePath: '/htdocs',
    password: 'geheim',
    ...overrides,
  };
}

function okPreflight(remoteSha: string | null): PreflightResult {
  return {
    ok: true,
    messages: ['Verbindung steht.'],
    failures: [],
    capabilities: { mkdirRecursive: true, rename: true },
    remoteManifest: null,
    remoteSha,
  };
}

function deployResult(commit: string): DeployResult {
  return {
    commit,
    uploaded: 2,
    deleted: 1,
    unchanged: 4,
    bytesUploaded: 1234,
    plan: { uploads: ['a', 'b'], deletes: ['c'], unchangedCount: 4 },
  };
}

let tmp: string;
let registry: SqliteProjectRegistry;
let targets: DeployTargetService;
let history: DeployHistoryStore;
let engine: DeployEngine;
let progress: DeployProgressMessage[];
let pushedTargets: DeployTargetsMessage[];
let service: DeployService;
let projectId: string;
let target: DeployTarget;
let seq = 0;

async function makeTarget(input: DeployTargetInput = targetInput()): Promise<DeployTarget> {
  const view = await targets.save(projectId, input);
  const project = await registry.get(projectId);
  return project?.deployTargets.find((t) => t.id === view.id) as DeployTarget;
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-deploy-service-'));
  registry = new SqliteProjectRegistry({
    dbPath: join(tmp, 'db.sqlite'),
    workspaceRoot: join(tmp, 'WebAIBuilder'),
    templatesRoot: TEMPLATES_ROOT,
  });
  targets = new DeployTargetService(registry, fakeSecrets(), {
    idFactory: () => `target-${(seq += 1)}`,
  });
  history = new DeployHistoryStore(join(tmp, 'history.json'));
  progress = [];
  pushedTargets = [];

  // Fake engine: emits progress like the real one, without network.
  engine = {
    preflight: vi.fn(async () => okPreflight('headsha')),
    deploy: vi.fn(async (_t: DeployTarget, _c, opts) => {
      opts.onProgress?.({ type: 'connecting' });
      const result = deployResult(opts.commitSha);
      opts.onProgress?.({ type: 'done', result });
      return result;
    }),
    rollback: vi.fn(async (_t: DeployTarget, _c, opts) => {
      opts.onProgress?.({ type: 'connecting' });
      const result = deployResult(opts.toCommitSha);
      opts.onProgress?.({ type: 'done', result });
      return result;
    }),
    detectDrift: vi.fn(
      async (_t: DeployTarget, _c, expectedSha): Promise<DriftResult> => ({
        drift: expectedSha !== 'remote-sha',
        expectedSha,
        remoteSha: 'remote-sha',
      }),
    ),
  };

  service = new DeployService({
    registry,
    targets,
    history,
    engine,
    currentSha: async () => 'headsha1234567',
    now: () => new Date('2026-07-12T09:00:00.000Z'),
    emitProgress: (m) => progress.push(m),
    emitTargets: (m) => pushedTargets.push(m),
  });

  seq = 0;
  const project = await registry.create({ name: 'Vereinsseite', templateId: 'leer' });
  projectId = project.id;
  target = await makeTarget();
});

afterEach(() => {
  registry.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('run (publish)', () => {
  it('runs preflight → deploy with HEAD SHA + site/ docroot and writes last_deployed', async () => {
    const outcome = await service.run(projectId, target.id, 'run-1');

    expect(outcome.status).toBe('deployed');

    // Deploy with currentSha as commitSha and the site/ docroot.
    const deployMock = engine.deploy as ReturnType<typeof vi.fn>;
    expect(deployMock).toHaveBeenCalledTimes(1);
    const [, , opts] = deployMock.mock.calls[0] as [DeployTarget, unknown, { siteDir: string; commitSha: string }];
    expect(opts.commitSha).toBe('headsha1234567');
    expect(opts.siteDir.endsWith(join('WebAIBuilder', 'vereinsseite', 'site'))).toBe(true);

    // last_deployed per target in the registry.
    const fresh = await registry.get(projectId);
    expect(fresh?.deployTargets[0]?.lastDeployedCommit).toBe('headsha1234567');
    expect(fresh?.deployTargets[0]?.lastDeployedAt).toBe('2026-07-12T09:00:00.000Z');
  });

  it('streams progress (with projectId/targetId/runId) and pushes the fresh target list', async () => {
    await service.run(projectId, target.id, 'run-1');

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((m) => m.projectId === projectId && m.targetId === target.id && m.runId === 'run-1')).toBe(true);
    expect(progress.some((m) => m.event.type === 'done')).toBe(true);

    expect(pushedTargets).toHaveLength(1);
    expect(pushedTargets[0]?.targets[0]?.lastDeployedCommit).toBe('headsha1234567');
  });

  it('records a successful deploy in the history', async () => {
    await service.run(projectId, target.id, 'run-1');
    const list = history.list(projectId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: 'deploy',
      ok: true,
      sha: 'headsha1234567',
      uploaded: 2,
      deleted: 1,
      targetName: 'IONOS',
    });
  });

  it('aborts on a failed preflight (no deploy, no last_deployed)', async () => {
    engine.preflight = vi.fn(async () => ({
      ok: false,
      messages: [],
      failures: ['Anmeldung fehlgeschlagen.'],
      capabilities: { mkdirRecursive: false, rename: false },
      remoteManifest: null,
      remoteSha: null,
    }));

    const outcome = await service.run(projectId, target.id, 'run-1');

    expect(outcome.status).toBe('preflight-failed');
    if (outcome.status === 'preflight-failed') {
      expect(outcome.preflight.failures).toContain('Anmeldung fehlgeschlagen.');
    }
    expect(engine.deploy).not.toHaveBeenCalled();
    const fresh = await registry.get(projectId);
    expect(fresh?.deployTargets[0]?.lastDeployedCommit).toBeUndefined();
    expect(progress.some((m) => m.event.type === 'error')).toBe(true);
  });

  it('fails cleanly without stored credentials', async () => {
    const noCreds = await makeTarget(targetInput({ name: 'Ohne', password: undefined }));
    const outcome = await service.run(projectId, noCreds.id, 'run-x');

    expect(outcome.status).toBe('preflight-failed');
    if (outcome.status === 'preflight-failed') {
      expect(outcome.preflight.failures[0]).toMatch(/No credentials/);
    }
    expect(engine.preflight).not.toHaveBeenCalled();
    expect(engine.deploy).not.toHaveBeenCalled();
  });

  it('reports an engine error as an error outcome + history entry', async () => {
    engine.deploy = vi.fn(async () => {
      throw new Error('Upload abgebrochen.');
    });

    const outcome = await service.run(projectId, target.id, 'run-1');

    expect(outcome).toEqual({ status: 'error', message: 'Upload abgebrochen.' });
    expect(progress.some((m) => m.event.type === 'error')).toBe(true);
    const list = history.list(projectId);
    expect(list[0]).toMatchObject({ ok: false, error: 'Upload abgebrochen.', kind: 'deploy' });
    // No last_deployed on failure.
    const fresh = await registry.get(projectId);
    expect(fresh?.deployTargets[0]?.lastDeployedCommit).toBeUndefined();
  });
});

describe('rollback (deploy an older version)', () => {
  it('deploys the target SHA and sets last_deployed to it', async () => {
    const outcome = await service.rollback(projectId, target.id, 'oldsha42', 'run-r');

    expect(outcome.status).toBe('deployed');
    expect(engine.rollback).toHaveBeenCalledTimes(1);
    const fresh = await registry.get(projectId);
    expect(fresh?.deployTargets[0]?.lastDeployedCommit).toBe('oldsha42');
    expect(history.list(projectId)[0]).toMatchObject({ kind: 'rollback', ok: true, sha: 'oldsha42' });
  });
});

describe('testConnection', () => {
  it('returns the structured preflight result (without manifest)', async () => {
    const result = await service.testConnection(projectId, target.id);
    expect(result.ok).toBe(true);
    expect(result.remoteSha).toBe('headsha');
    // The manifest's hash tree is NOT passed to the renderer.
    expect((result as unknown as Record<string, unknown>)['remoteManifest']).toBeUndefined();
  });

  it('reports missing credentials structured instead of throwing', async () => {
    const noCreds = await makeTarget(targetInput({ name: 'Ohne', password: undefined }));
    const result = await service.testConnection(projectId, noCreds.id);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/No credentials/);
    expect(engine.preflight).not.toHaveBeenCalled();
  });
});

describe('drift', () => {
  it('passes the engine drift through (expected SHA from the registry)', async () => {
    await service.run(projectId, target.id, 'run-1'); // sets last_deployed = headsha1234567
    const drift = await service.drift(projectId, target.id);
    expect(drift.expectedSha).toBe('headsha1234567');
    expect(drift.remoteSha).toBe('remote-sha');
    expect(drift.drift).toBe(true);
  });

  it('no network access, no drift without credentials', async () => {
    const noCreds = await makeTarget(targetInput({ name: 'Ohne', password: undefined }));
    const drift = await service.drift(projectId, noCreds.id);
    expect(drift.remoteSha).toBeNull();
    expect(engine.detectDrift).not.toHaveBeenCalled();
  });
});

describe('realDeployEngine', () => {
  it('bundles the real engine functions (contract with @webaibuilder/deploy)', () => {
    expect(typeof realDeployEngine.preflight).toBe('function');
    expect(typeof realDeployEngine.deploy).toBe('function');
    expect(typeof realDeployEngine.rollback).toBe('function');
    expect(typeof realDeployEngine.detectDrift).toBe('function');
  });
});
