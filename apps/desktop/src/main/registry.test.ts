/**
 * Headless tests of the SQLite project registry: temporary DB + temporary
 * workspace root, real templates from resources/templates. Runs without
 * Electron — the `app.getPath('userData')` wiring (paths.ts) runs only at app
 * runtime.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeployTarget } from '@webaibuilder/core';

import { SqliteProjectRegistry } from './registry';

const TEMPLATES_ROOT = fileURLToPath(new URL('../../resources/templates', import.meta.url));

let tmp: string;
let workspaceRoot: string;
let dbPath: string;
let registry: SqliteProjectRegistry;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-registry-'));
  workspaceRoot = join(tmp, 'WebAIBuilder');
  dbPath = join(tmp, 'webaibuilder.db');
  registry = new SqliteProjectRegistry({ dbPath, workspaceRoot, templatesRoot: TEMPLATES_ROOT });
});

afterEach(() => {
  registry.close();
  rmSync(tmp, { recursive: true, force: true });
});

function makeTarget(overrides: Partial<DeployTarget> & { id: string }): DeployTarget {
  return {
    name: 'Webspace',
    protocol: 'sftp',
    host: 'ssh.example.org',
    port: 22,
    username: 'w0123456',
    remotePath: '/htdocs',
    credentialRef: `keyring:${overrides.id}`,
    ...overrides,
  };
}

describe('starter templates', () => {
  it('returns the templates from the manifest (id, name, description)', async () => {
    const templates = await registry.listTemplates();
    expect(templates.map((t) => t.id)).toEqual(['one-pager', 'multi-page', 'blank']);
    for (const t of templates) {
      expect(t.name).not.toBe('');
      expect(t.description).not.toBe('');
    }
  });
});

describe('create', () => {
  it('creates the workspace, site/ docroot, and project.json and copies the template', async () => {
    const project = await registry.create({ name: 'Club Website', templateId: 'one-pager' });

    expect(project.name).toBe('Club Website');
    expect(project.templateId).toBe('one-pager');
    expect(project.workspaceDir).toBe(join(workspaceRoot, 'club-website'));
    expect(project.siteDir).toBe(join(project.workspaceDir, 'site'));
    expect(project.deployTargets).toEqual([]);

    // Template was copied into site/ (incl. SITE.md for the AI agent).
    for (const file of ['index.html', 'styles.css', 'site.js', 'SITE.md']) {
      expect(existsSync(join(project.siteDir, file)), `site/${file} missing`).toBe(true);
    }

    // project.json in the workspace root directory.
    const projectFile = JSON.parse(
      readFileSync(join(project.workspaceDir, 'project.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(projectFile['id']).toBe(project.id);
    expect(projectFile['name']).toBe('Club Website');
    expect(projectFile['templateId']).toBe('one-pager');
  });

  it('copies all pages including shared files for the multi-page template', async () => {
    const project = await registry.create({ name: 'Three Pages', templateId: 'multi-page' });
    for (const file of [
      'index.html',
      'about.html',
      'contact.html',
      'styles.css',
      'site.js',
      'SITE.md',
    ]) {
      expect(existsSync(join(project.siteDir, file)), `site/${file} missing`).toBe(true);
    }
  });

  it('rejects an unknown template without creating anything', async () => {
    await expect(registry.create({ name: 'Broken', templateId: 'does-not-exist' })).rejects.toThrow(
      'Unknown template',
    );
    expect(await registry.list()).toEqual([]);
    expect(existsSync(join(workspaceRoot, 'broken'))).toBe(false);
  });

  it('rejects an empty name', async () => {
    await expect(registry.create({ name: '   ', templateId: 'blank' })).rejects.toThrow(
      'project name',
    );
  });

  it('resolves name collisions via unique directories', async () => {
    const first = await registry.create({ name: 'Test', templateId: 'blank' });
    const second = await registry.create({ name: 'Test', templateId: 'blank' });
    expect(first.workspaceDir).toBe(join(workspaceRoot, 'test'));
    expect(second.workspaceDir).toBe(join(workspaceRoot, 'test-2'));
    expect(existsSync(join(second.siteDir, 'index.html'))).toBe(true);
  });
});

describe('list / get / update / delete', () => {
  it('create → list → get Roundtrip', async () => {
    const created = await registry.create({ name: 'Roundtrip', templateId: 'blank' });

    const listed = await registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const fetched = await registry.get(created.id);
    expect(fetched).toEqual(created);

    expect(await registry.get('unknown')).toBeNull();
  });

  it('update changes the name and the last used backend', async () => {
    const created = await registry.create({ name: 'Old', templateId: 'blank' });
    const updated = await registry.update(created.id, { name: 'New', lastBackend: 'claude-sdk' });

    expect(updated.name).toBe('New');
    expect(updated.lastBackend).toBe('claude-sdk');
    // Renaming does NOT move the workspace.
    expect(updated.workspaceDir).toBe(created.workspaceDir);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));

    const fetched = await registry.get(created.id);
    expect(fetched?.name).toBe('New');
    expect(fetched?.lastBackend).toBe('claude-sdk');
  });

  it('update on an unknown ID fails', async () => {
    await expect(registry.update('unknown', { name: 'x' })).rejects.toThrow('Project not found');
  });

  it('stores the deployed commit SHA per deploy target', async () => {
    const created = await registry.create({ name: 'Deploy', templateId: 'one-pager' });

    const ionos = makeTarget({ id: 'target-ionos', name: 'IONOS', lastDeployedCommit: 'aaa111' });
    const hetzner = makeTarget({
      id: 'target-hetzner',
      name: 'Hetzner',
      lastDeployedCommit: 'bbb222',
      lastDeployedAt: '2026-07-12T10:00:00.000Z',
    });
    await registry.update(created.id, { deployTargets: [ionos, hetzner] });

    let fetched = await registry.get(created.id);
    expect(fetched?.deployTargets).toHaveLength(2);
    expect(fetched?.deployTargets.find((t) => t.id === 'target-ionos')?.lastDeployedCommit).toBe(
      'aaa111',
    );
    expect(fetched?.deployTargets.find((t) => t.id === 'target-hetzner')?.lastDeployedCommit).toBe(
      'bbb222',
    );
    expect(fetched?.deployTargets.find((t) => t.id === 'target-hetzner')?.lastDeployedAt).toBe(
      '2026-07-12T10:00:00.000Z',
    );

    // New deploy to ONE target — the other keeps its SHA.
    await registry.update(created.id, {
      deployTargets: [{ ...ionos, lastDeployedCommit: 'ccc333' }, hetzner],
    });
    fetched = await registry.get(created.id);
    expect(fetched?.deployTargets.find((t) => t.id === 'target-ionos')?.lastDeployedCommit).toBe(
      'ccc333',
    );
    expect(fetched?.deployTargets.find((t) => t.id === 'target-hetzner')?.lastDeployedCommit).toBe(
      'bbb222',
    );

    // Target without a deploy: SHA stays empty.
    await registry.update(created.id, { deployTargets: [makeTarget({ id: 'target-new' })] });
    fetched = await registry.get(created.id);
    expect(fetched?.deployTargets).toHaveLength(1);
    expect(fetched?.deployTargets[0]?.lastDeployedCommit).toBeUndefined();
  });

  it('delete removes the registry entry but leaves the workspace in place', async () => {
    const created = await registry.create({ name: 'Delete me', templateId: 'blank' });
    await registry.update(created.id, { deployTargets: [makeTarget({ id: 'target-1' })] });

    await registry.delete(created.id);

    expect(await registry.get(created.id)).toBeNull();
    expect(await registry.list()).toEqual([]);
    // User data stays on disk.
    expect(existsSync(join(created.siteDir, 'index.html'))).toBe(true);

    await expect(registry.delete(created.id)).rejects.toThrow('Project not found');
  });
});

describe('persistence', () => {
  it('projects incl. deploy targets survive reopening the DB', async () => {
    const created = await registry.create({ name: 'Stays', templateId: 'multi-page' });
    await registry.update(created.id, {
      deployTargets: [makeTarget({ id: 'target-1', lastDeployedCommit: 'abc123' })],
    });
    registry.close();

    // Second "app run": same DB file, new instance (migrations run again
    // idempotently).
    registry = new SqliteProjectRegistry({ dbPath, workspaceRoot, templatesRoot: TEMPLATES_ROOT });
    const fetched = await registry.get(created.id);
    expect(fetched?.name).toBe('Stays');
    expect(fetched?.templateId).toBe('multi-page');
    expect(fetched?.deployTargets[0]?.lastDeployedCommit).toBe('abc123');
  });
});
