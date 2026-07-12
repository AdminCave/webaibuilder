/**
 * Headless-Tests der SQLite-Projekt-Registry: temporäre DB + temporäre
 * Workspace-Wurzel, echte Vorlagen aus resources/templates. Läuft ohne
 * Electron — die `app.getPath('userData')`-Verdrahtung (paths.ts) wird nur
 * zur App-Laufzeit ausgeführt.
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

describe('Starter-Vorlagen', () => {
  it('liefert die Vorlagen aus dem Manifest (id, name, description)', async () => {
    const templates = await registry.listTemplates();
    expect(templates.map((t) => t.id)).toEqual(['einseiter', 'mehrseiter', 'leer']);
    for (const t of templates) {
      expect(t.name).not.toBe('');
      expect(t.description).not.toBe('');
    }
  });
});

describe('create', () => {
  it('legt Workspace, site/-Docroot und project.json an und kopiert die Vorlage', async () => {
    const project = await registry.create({ name: 'Vereinsseite Müller', templateId: 'einseiter' });

    expect(project.name).toBe('Vereinsseite Müller');
    expect(project.templateId).toBe('einseiter');
    expect(project.workspaceDir).toBe(join(workspaceRoot, 'vereinsseite-mueller'));
    expect(project.siteDir).toBe(join(project.workspaceDir, 'site'));
    expect(project.deployTargets).toEqual([]);

    // Vorlage wurde nach site/ kopiert (inkl. SITE.md für den KI-Agenten).
    for (const file of ['index.html', 'styles.css', 'site.js', 'SITE.md']) {
      expect(existsSync(join(project.siteDir, file)), `site/${file} fehlt`).toBe(true);
    }

    // project.json im Workspace-Wurzelverzeichnis.
    const projectFile = JSON.parse(
      readFileSync(join(project.workspaceDir, 'project.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(projectFile['id']).toBe(project.id);
    expect(projectFile['name']).toBe('Vereinsseite Müller');
    expect(projectFile['templateId']).toBe('einseiter');
  });

  it('kopiert beim Mehrseiter alle Seiten samt gemeinsamer Dateien', async () => {
    const project = await registry.create({ name: 'Drei Seiten', templateId: 'mehrseiter' });
    for (const file of [
      'index.html',
      'ueber.html',
      'kontakt.html',
      'styles.css',
      'site.js',
      'SITE.md',
    ]) {
      expect(existsSync(join(project.siteDir, file)), `site/${file} fehlt`).toBe(true);
    }
  });

  it('lehnt eine unbekannte Vorlage ab, ohne etwas anzulegen', async () => {
    await expect(registry.create({ name: 'Kaputt', templateId: 'gibts-nicht' })).rejects.toThrow(
      'Unbekannte Vorlage',
    );
    expect(await registry.list()).toEqual([]);
    expect(existsSync(join(workspaceRoot, 'kaputt'))).toBe(false);
  });

  it('lehnt einen leeren Namen ab', async () => {
    await expect(registry.create({ name: '   ', templateId: 'leer' })).rejects.toThrow(
      'Projektname',
    );
  });

  it('löst Namenskollisionen über eindeutige Verzeichnisse auf', async () => {
    const first = await registry.create({ name: 'Test', templateId: 'leer' });
    const second = await registry.create({ name: 'Test', templateId: 'leer' });
    expect(first.workspaceDir).toBe(join(workspaceRoot, 'test'));
    expect(second.workspaceDir).toBe(join(workspaceRoot, 'test-2'));
    expect(existsSync(join(second.siteDir, 'index.html'))).toBe(true);
  });
});

describe('list / get / update / delete', () => {
  it('create → list → get Roundtrip', async () => {
    const created = await registry.create({ name: 'Roundtrip', templateId: 'leer' });

    const listed = await registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const fetched = await registry.get(created.id);
    expect(fetched).toEqual(created);

    expect(await registry.get('unbekannt')).toBeNull();
  });

  it('update ändert Name und zuletzt benutztes Backend', async () => {
    const created = await registry.create({ name: 'Alt', templateId: 'leer' });
    const updated = await registry.update(created.id, { name: 'Neu', lastBackend: 'claude-sdk' });

    expect(updated.name).toBe('Neu');
    expect(updated.lastBackend).toBe('claude-sdk');
    // Umbenennen verschiebt den Workspace NICHT.
    expect(updated.workspaceDir).toBe(created.workspaceDir);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));

    const fetched = await registry.get(created.id);
    expect(fetched?.name).toBe('Neu');
    expect(fetched?.lastBackend).toBe('claude-sdk');
  });

  it('update auf unbekannte ID schlägt fehl', async () => {
    await expect(registry.update('unbekannt', { name: 'x' })).rejects.toThrow('nicht gefunden');
  });

  it('speichert die deployte Commit-SHA pro Deploy-Ziel', async () => {
    const created = await registry.create({ name: 'Deploy', templateId: 'einseiter' });

    const ionos = makeTarget({ id: 'ziel-ionos', name: 'IONOS', lastDeployedCommit: 'aaa111' });
    const hetzner = makeTarget({
      id: 'ziel-hetzner',
      name: 'Hetzner',
      lastDeployedCommit: 'bbb222',
      lastDeployedAt: '2026-07-12T10:00:00.000Z',
    });
    await registry.update(created.id, { deployTargets: [ionos, hetzner] });

    let fetched = await registry.get(created.id);
    expect(fetched?.deployTargets).toHaveLength(2);
    expect(fetched?.deployTargets.find((t) => t.id === 'ziel-ionos')?.lastDeployedCommit).toBe(
      'aaa111',
    );
    expect(fetched?.deployTargets.find((t) => t.id === 'ziel-hetzner')?.lastDeployedCommit).toBe(
      'bbb222',
    );
    expect(fetched?.deployTargets.find((t) => t.id === 'ziel-hetzner')?.lastDeployedAt).toBe(
      '2026-07-12T10:00:00.000Z',
    );

    // Neuer Deploy auf EIN Ziel — das andere behält seine SHA.
    await registry.update(created.id, {
      deployTargets: [{ ...ionos, lastDeployedCommit: 'ccc333' }, hetzner],
    });
    fetched = await registry.get(created.id);
    expect(fetched?.deployTargets.find((t) => t.id === 'ziel-ionos')?.lastDeployedCommit).toBe(
      'ccc333',
    );
    expect(fetched?.deployTargets.find((t) => t.id === 'ziel-hetzner')?.lastDeployedCommit).toBe(
      'bbb222',
    );

    // Ziel ohne Deploy: SHA bleibt leer.
    await registry.update(created.id, { deployTargets: [makeTarget({ id: 'ziel-neu' })] });
    fetched = await registry.get(created.id);
    expect(fetched?.deployTargets).toHaveLength(1);
    expect(fetched?.deployTargets[0]?.lastDeployedCommit).toBeUndefined();
  });

  it('delete entfernt den Registry-Eintrag, lässt den Workspace aber liegen', async () => {
    const created = await registry.create({ name: 'Weg damit', templateId: 'leer' });
    await registry.update(created.id, { deployTargets: [makeTarget({ id: 'ziel-1' })] });

    await registry.delete(created.id);

    expect(await registry.get(created.id)).toBeNull();
    expect(await registry.list()).toEqual([]);
    // Nutzerdaten bleiben auf der Platte.
    expect(existsSync(join(created.siteDir, 'index.html'))).toBe(true);

    await expect(registry.delete(created.id)).rejects.toThrow('nicht gefunden');
  });
});

describe('Persistenz', () => {
  it('Projekte inkl. Deploy-Ziele überleben ein erneutes Öffnen der DB', async () => {
    const created = await registry.create({ name: 'Bleibt', templateId: 'mehrseiter' });
    await registry.update(created.id, {
      deployTargets: [makeTarget({ id: 'ziel-1', lastDeployedCommit: 'abc123' })],
    });
    registry.close();

    // Zweiter "App-Lauf": gleiche DB-Datei, neue Instanz (Migrationen laufen
    // idempotent erneut an).
    registry = new SqliteProjectRegistry({ dbPath, workspaceRoot, templatesRoot: TEMPLATES_ROOT });
    const fetched = await registry.get(created.id);
    expect(fetched?.name).toBe('Bleibt');
    expect(fetched?.templateId).toBe('mehrseiter');
    expect(fetched?.deployTargets[0]?.lastDeployedCommit).toBe('abc123');
  });
});
