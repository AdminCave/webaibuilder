/**
 * Headless tests of the deploy target management: real SQLite registry (temporary
 * DB) + injected keychain fake. Verifies the split of secret-free (DB) ↔ secret
 * (keychain), in particular that a delete also removes the secret.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeployTarget, Project } from '@webaibuilder/core';

import type { DeployTargetInput } from '../shared/deploy';
import { credentialRefFor, DeployTargetService, type DeploySecretsPort } from './deployTargets';
import { SqliteProjectRegistry } from './registry';

const TEMPLATES_ROOT = fileURLToPath(new URL('../../resources/templates', import.meta.url));

/** Keychain fake with an inspectable store (account = `<kind>:<id>`). */
function fakeSecrets(): { port: DeploySecretsPort; store: Map<string, string> } {
  const store = new Map<string, string>();
  const port: DeploySecretsPort = {
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
  return { port, store };
}

function input(overrides: Partial<DeployTargetInput> = {}): DeployTargetInput {
  return {
    name: 'IONOS',
    protocol: 'sftp',
    host: 'ssh.example.org',
    port: 22,
    username: 'w012345',
    remotePath: '/htdocs',
    password: 'secret',
    ...overrides,
  };
}

let tmp: string;
let registry: SqliteProjectRegistry;
let secrets: ReturnType<typeof fakeSecrets>;
let service: DeployTargetService;
let project: Project;
let seq = 0;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-deploy-targets-'));
  registry = new SqliteProjectRegistry({
    dbPath: join(tmp, 'db.sqlite'),
    workspaceRoot: join(tmp, 'WebAIBuilder'),
    templatesRoot: TEMPLATES_ROOT,
  });
  secrets = fakeSecrets();
  seq = 0;
  service = new DeployTargetService(registry, secrets.port, {
    idFactory: () => `target-${(seq += 1)}`,
  });
  project = await registry.create({ name: 'Club website', templateId: 'blank' });
});

afterEach(() => {
  registry.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Sets a deployed SHA for a target directly in the registry (as after a deploy). */
async function setDeployed(target: DeployTarget, commit: string): Promise<void> {
  const fresh = await registry.get(project.id);
  const targets = (fresh?.deployTargets ?? []).map((t) =>
    t.id === target.id ? { ...t, lastDeployedCommit: commit, lastDeployedAt: '2026-07-12T00:00:00.000Z' } : t,
  );
  await registry.update(project.id, { deployTargets: targets });
}

describe('save', () => {
  it('creates a target, writes secret-free fields to the registry and the password to the keychain', async () => {
    const view = await service.save(project.id, input());

    expect(view.id).toBe('target-1');
    expect(view.credentialRef).toBe(credentialRefFor('target-1'));
    expect(view.hasCredentials).toBe(true);

    // Secret-free in the DB.
    const fetched = await registry.get(project.id);
    expect(fetched?.deployTargets).toHaveLength(1);
    expect(fetched?.deployTargets[0]?.host).toBe('ssh.example.org');

    // Password as JSON in the keychain, not in the DB.
    expect(secrets.store.get('deploy:target-1')).toBe(JSON.stringify({ password: 'secret' }));
    const creds = service.getCredentials('target-1');
    expect(creds).toEqual({ password: 'secret' });
  });

  it('creates a target without a password (hasCredentials=false)', async () => {
    const view = await service.save(project.id, input({ password: undefined }));
    expect(view.hasCredentials).toBe(false);
    expect(secrets.store.has('deploy:target-1')).toBe(false);
  });

  it('stores a passphrase in addition to the password (SFTP)', async () => {
    await service.save(project.id, input({ passphrase: 'pp' }));
    expect(service.getCredentials('target-1')).toEqual({ password: 'secret', passphrase: 'pp' });
  });

  it('changes secret-free fields, keeps last_deployed, and leaves the password unchanged', async () => {
    const created = await service.save(project.id, input());
    await setDeployed({ ...created }, 'abc1234');

    const edited = await service.save(
      project.id,
      input({ id: created.id, host: 'new.example.org', password: undefined }),
    );

    expect(edited.host).toBe('new.example.org');
    // last_deployed is preserved (a pure edit does not reset the state).
    expect(edited.lastDeployedCommit).toBe('abc1234');
    // Password unchanged (undefined = don't touch).
    expect(service.getCredentials(created.id)).toEqual({ password: 'secret' });
    expect(edited.hasCredentials).toBe(true);
  });

  it('replaces the password when one is sent along', async () => {
    const created = await service.save(project.id, input());
    await service.save(project.id, input({ id: created.id, password: 'new' }));
    expect(service.getCredentials(created.id)).toEqual({ password: 'new' });
  });

  it('rejects invalid input without writing anything', async () => {
    await expect(service.save(project.id, input({ host: '' }))).rejects.toThrow(/host/);
    expect((await registry.get(project.id))?.deployTargets).toHaveLength(0);
    expect(secrets.store.size).toBe(0);
  });

  it('rejects editing an unknown target ID', async () => {
    await expect(service.save(project.id, input({ id: 'does-not-exist' }))).rejects.toThrow(
      /does not exist in this project/,
    );
  });
});

describe('list', () => {
  it('reflects hasCredentials per target', async () => {
    await service.save(project.id, input({ name: 'A' }));
    await service.save(project.id, input({ name: 'B', password: undefined }));

    const list = await service.list(project.id);
    expect(list.map((t) => [t.name, t.hasCredentials])).toEqual([
      ['A', true],
      ['B', false],
    ]);
  });
});

describe('delete', () => {
  it('removes the target from the registry AND the password from the keychain', async () => {
    const created = await service.save(project.id, input());
    expect(secrets.store.has('deploy:target-1')).toBe(true);

    await service.delete(project.id, created.id);

    expect((await registry.get(project.id))?.deployTargets).toHaveLength(0);
    // No orphaned secret in the keychain.
    expect(secrets.store.has('deploy:target-1')).toBe(false);
  });

  it('leaves other targets and their secrets untouched', async () => {
    const a = await service.save(project.id, input({ name: 'A' }));
    await service.save(project.id, input({ name: 'B' }));

    await service.delete(project.id, a.id);

    const list = await service.list(project.id);
    expect(list.map((t) => t.name)).toEqual(['B']);
    expect(secrets.store.has('deploy:target-1')).toBe(false);
    expect(secrets.store.has('deploy:target-2')).toBe(true);
  });
});

describe('multi-target', () => {
  it('tracks last_deployed independently per target', async () => {
    const a = await service.save(project.id, input({ name: 'A' }));
    const b = await service.save(project.id, input({ name: 'B' }));
    await setDeployed(a, 'aaa');
    await setDeployed(b, 'bbb');

    const list = await service.list(project.id);
    expect(list.find((t) => t.id === a.id)?.lastDeployedCommit).toBe('aaa');
    expect(list.find((t) => t.id === b.id)?.lastDeployedCommit).toBe('bbb');
  });
});
