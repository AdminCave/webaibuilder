/**
 * Headless-Tests der Deploy-Ziel-Verwaltung: echte SQLite-Registry (temporäre
 * DB) + injizierter Schlüsselbund-Fake. Prüft die Trennung secret-frei (DB) ↔
 * secret (Schlüsselbund), insbesondere dass ein Löschen auch das Secret entfernt.
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

/** Schlüsselbund-Fake mit einsehbarem Store (Account = `<kind>:<id>`). */
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
    password: 'geheim',
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
  project = await registry.create({ name: 'Vereinsseite', templateId: 'leer' });
});

afterEach(() => {
  registry.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Setzt eine deployte SHA für ein Ziel direkt in der Registry (wie nach Deploy). */
async function setDeployed(target: DeployTarget, commit: string): Promise<void> {
  const fresh = await registry.get(project.id);
  const targets = (fresh?.deployTargets ?? []).map((t) =>
    t.id === target.id ? { ...t, lastDeployedCommit: commit, lastDeployedAt: '2026-07-12T00:00:00.000Z' } : t,
  );
  await registry.update(project.id, { deployTargets: targets });
}

describe('save', () => {
  it('legt ein Ziel an, schreibt secret-freie Felder in die Registry und das Passwort in den Schlüsselbund', async () => {
    const view = await service.save(project.id, input());

    expect(view.id).toBe('target-1');
    expect(view.credentialRef).toBe(credentialRefFor('target-1'));
    expect(view.hasCredentials).toBe(true);

    // Secret-frei in der DB.
    const fetched = await registry.get(project.id);
    expect(fetched?.deployTargets).toHaveLength(1);
    expect(fetched?.deployTargets[0]?.host).toBe('ssh.example.org');

    // Passwort als JSON im Schlüsselbund, nicht in der DB.
    expect(secrets.store.get('deploy:target-1')).toBe(JSON.stringify({ password: 'geheim' }));
    const creds = service.getCredentials('target-1');
    expect(creds).toEqual({ password: 'geheim' });
  });

  it('legt ein Ziel ohne Passwort an (hasCredentials=false)', async () => {
    const view = await service.save(project.id, input({ password: undefined }));
    expect(view.hasCredentials).toBe(false);
    expect(secrets.store.has('deploy:target-1')).toBe(false);
  });

  it('speichert Passphrase zusätzlich zum Passwort (SFTP)', async () => {
    await service.save(project.id, input({ passphrase: 'pp' }));
    expect(service.getCredentials('target-1')).toEqual({ password: 'geheim', passphrase: 'pp' });
  });

  it('ändert secret-freie Felder, behält last_deployed und lässt das Passwort unverändert', async () => {
    const created = await service.save(project.id, input());
    await setDeployed({ ...created }, 'abc1234');

    const edited = await service.save(
      project.id,
      input({ id: created.id, host: 'neu.example.org', password: undefined }),
    );

    expect(edited.host).toBe('neu.example.org');
    // last_deployed bleibt erhalten (reines Bearbeiten setzt den Stand nicht zurück).
    expect(edited.lastDeployedCommit).toBe('abc1234');
    // Passwort unverändert (undefined = nicht anfassen).
    expect(service.getCredentials(created.id)).toEqual({ password: 'geheim' });
    expect(edited.hasCredentials).toBe(true);
  });

  it('ersetzt das Passwort, wenn eines mitgeschickt wird', async () => {
    const created = await service.save(project.id, input());
    await service.save(project.id, input({ id: created.id, password: 'neu' }));
    expect(service.getCredentials(created.id)).toEqual({ password: 'neu' });
  });

  it('lehnt ungültige Eingaben ab, ohne etwas zu schreiben', async () => {
    await expect(service.save(project.id, input({ host: '' }))).rejects.toThrow(/Host/);
    expect((await registry.get(project.id))?.deployTargets).toHaveLength(0);
    expect(secrets.store.size).toBe(0);
  });

  it('lehnt das Bearbeiten einer unbekannten Ziel-ID ab', async () => {
    await expect(service.save(project.id, input({ id: 'gibts-nicht' }))).rejects.toThrow(
      /gibt es in diesem Projekt nicht/,
    );
  });
});

describe('list', () => {
  it('spiegelt hasCredentials pro Ziel', async () => {
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
  it('entfernt das Ziel aus der Registry UND das Passwort aus dem Schlüsselbund', async () => {
    const created = await service.save(project.id, input());
    expect(secrets.store.has('deploy:target-1')).toBe(true);

    await service.delete(project.id, created.id);

    expect((await registry.get(project.id))?.deployTargets).toHaveLength(0);
    // Kein verwaistes Secret im Schlüsselbund.
    expect(secrets.store.has('deploy:target-1')).toBe(false);
  });

  it('lässt andere Ziele samt ihren Secrets unberührt', async () => {
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
  it('führt last_deployed pro Ziel unabhängig', async () => {
    const a = await service.save(project.id, input({ name: 'A' }));
    const b = await service.save(project.id, input({ name: 'B' }));
    await setDeployed(a, 'aaa');
    await setDeployed(b, 'bbb');

    const list = await service.list(project.id);
    expect(list.find((t) => t.id === a.id)?.lastDeployedCommit).toBe('aaa');
    expect(list.find((t) => t.id === b.id)?.lastDeployedCommit).toBe('bbb');
  });
});
