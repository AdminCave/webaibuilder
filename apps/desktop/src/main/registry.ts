/**
 * Projekt-Registry — persistent mit better-sqlite3 (M1).
 *
 * Implementiert den `ProjectRegistry`-Vertrag aus @webaibuilder/core:
 * create/list/get/update/delete + Vorlagen-Liste. `create` legt den Workspace
 * (`~/WebAIBuilder/<slug>/` mit `site/`-Docroot und `project.json`) an und
 * befüllt `site/` aus einer Starter-Vorlage.
 *
 * Bewusst Electron-frei: DB-Pfad, Workspace-Wurzel und Vorlagen-Ordner werden
 * injiziert (headless testbar mit vitest). Die Electron-Verdrahtung
 * (`app.getPath('userData')` usw.) liegt in `paths.ts` und läuft nur zur
 * App-Laufzeit.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

import type {
  BackendId,
  DeployProtocol,
  DeployTarget,
  Project,
  ProjectCreateInput,
  ProjectRegistry,
  ProjectUpdateInput,
  StarterTemplate,
} from '@webaibuilder/core';
import { PROJECT_FILE_NAME, SITE_DIRNAME } from '@webaibuilder/core';

import { copyTemplateInto, loadStarterTemplates } from './templates';

export interface ProjectRegistryOptions {
  /** Absoluter Pfad der SQLite-Datei, z. B. `<userData>/webaibuilder.db`. */
  dbPath: string;
  /** Wurzel für Projekt-Workspaces, z. B. `~/WebAIBuilder`. */
  workspaceRoot: string;
  /** Ordner mit `manifest.json` + Vorlagen, z. B. `resources/templates`. */
  templatesRoot: string;
}

/* ------------------------------------------------------------------ */
/* Migrationen — einfache Versions-Tabelle, damit das Schema wachsen kann. */
/* ------------------------------------------------------------------ */

const MIGRATIONS: readonly string[] = [
  // v1: Projekte + Deploy-Ziele (inkl. deployter Commit-SHA pro Ziel, PLAN §4).
  `
  CREATE TABLE projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    workspace_dir TEXT NOT NULL UNIQUE,
    template_id   TEXT NOT NULL,
    last_backend  TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE TABLE deploy_targets (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position             INTEGER NOT NULL,
    name                 TEXT NOT NULL,
    protocol             TEXT NOT NULL,
    host                 TEXT NOT NULL,
    port                 INTEGER NOT NULL,
    username             TEXT NOT NULL,
    remote_path          TEXT NOT NULL,
    credential_ref       TEXT NOT NULL,
    last_deployed_commit TEXT,
    last_deployed_at     TEXT
  );
  CREATE INDEX idx_deploy_targets_project ON deploy_targets(project_id);
  `,
];

function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare<[], { version: number }>('SELECT version FROM schema_version').get();
  const current = row?.version ?? 0;
  if (row === undefined) {
    db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v];
    if (sql === undefined) break;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    })();
  }
}

/* ------------------------------------------------------------------ */
/* Zeilen-Typen                                                        */
/* ------------------------------------------------------------------ */

interface ProjectRow {
  id: string;
  name: string;
  workspace_dir: string;
  template_id: string;
  last_backend: string | null;
  created_at: string;
  updated_at: string;
}

interface DeployTargetRow {
  id: string;
  project_id: string;
  position: number;
  name: string;
  protocol: string;
  host: string;
  port: number;
  username: string;
  remote_path: string;
  credential_ref: string;
  last_deployed_commit: string | null;
  last_deployed_at: string | null;
}

function targetFromRow(row: DeployTargetRow): DeployTarget {
  const target: DeployTarget = {
    id: row.id,
    name: row.name,
    protocol: row.protocol as DeployProtocol,
    host: row.host,
    port: row.port,
    username: row.username,
    remotePath: row.remote_path,
    credentialRef: row.credential_ref,
  };
  if (row.last_deployed_commit !== null) target.lastDeployedCommit = row.last_deployed_commit;
  if (row.last_deployed_at !== null) target.lastDeployedAt = row.last_deployed_at;
  return target;
}

/** Slug fürs Workspace-Verzeichnis: `~/WebAIBuilder/<slug>/`. */
function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'projekt' : slug;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export class SqliteProjectRegistry implements ProjectRegistry {
  private readonly db: Database.Database;
  private readonly workspaceRoot: string;
  private readonly templatesRoot: string;

  constructor(options: ProjectRegistryOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.templatesRoot = options.templatesRoot;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  list(): Promise<Project[]> {
    const rows = this.db
      .prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY created_at DESC, name ASC')
      .all();
    return Promise.resolve(rows.map((row) => this.toProject(row)));
  }

  get(id: string): Promise<Project | null> {
    const row = this.db
      .prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?')
      .get(id);
    return Promise.resolve(row === undefined ? null : this.toProject(row));
  }

  create(input: ProjectCreateInput): Promise<Project> {
    const name = input.name.trim();
    if (name === '') {
      return Promise.reject(new Error('Der Projektname darf nicht leer sein.'));
    }

    // Vorlage VOR dem Anlegen von Verzeichnissen prüfen — eine unbekannte
    // Vorlage darf weder Dateien noch DB-Zeilen hinterlassen.
    const templates = loadStarterTemplates(this.templatesRoot);
    if (!templates.some((t) => t.id === input.templateId)) {
      return Promise.reject(new Error(`Unbekannte Vorlage: "${input.templateId}".`));
    }

    const now = new Date().toISOString();
    const workspaceDir = this.uniqueWorkspaceDir(toSlug(name));
    const siteDir = join(workspaceDir, SITE_DIRNAME);

    const project: Project = {
      id: randomUUID(),
      name,
      workspaceDir,
      siteDir,
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
      deployTargets: [],
    };

    // Workspace anlegen und aus der Vorlage befüllen (wirft bei unbekannter
    // Vorlage, BEVOR etwas in die DB geschrieben wird).
    mkdirSync(siteDir, { recursive: true });
    copyTemplateInto(this.templatesRoot, input.templateId, siteDir);
    this.writeProjectFile(project);

    this.db
      .prepare(
        `INSERT INTO projects (id, name, workspace_dir, template_id, last_backend, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(project.id, project.name, project.workspaceDir, project.templateId, now, now);

    return Promise.resolve(project);
  }

  update(id: string, patch: ProjectUpdateInput): Promise<Project> {
    const row = this.db
      .prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?')
      .get(id);
    if (row === undefined) {
      return Promise.reject(new Error('Projekt nicht gefunden.'));
    }

    const name = patch.name?.trim();
    if (name !== undefined && name === '') {
      return Promise.reject(new Error('Der Projektname darf nicht leer sein.'));
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE projects SET name = ?, last_backend = ?, updated_at = ? WHERE id = ?')
        .run(name ?? row.name, patch.lastBackend ?? row.last_backend, now, id);

      if (patch.deployTargets !== undefined) {
        this.db.prepare('DELETE FROM deploy_targets WHERE project_id = ?').run(id);
        const insert = this.db.prepare(
          `INSERT INTO deploy_targets
             (id, project_id, position, name, protocol, host, port, username,
              remote_path, credential_ref, last_deployed_commit, last_deployed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        patch.deployTargets.forEach((t, position) => {
          insert.run(
            t.id,
            id,
            position,
            t.name,
            t.protocol,
            t.host,
            t.port,
            t.username,
            t.remotePath,
            t.credentialRef,
            t.lastDeployedCommit ?? null,
            t.lastDeployedAt ?? null,
          );
        });
      }
    })();

    const updatedRow = this.db
      .prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?')
      .get(id);
    if (updatedRow === undefined) {
      return Promise.reject(new Error('Projekt nicht gefunden.'));
    }
    const project = this.toProject(updatedRow);

    // project.json im Workspace synchron halten — best effort: ein von Hand
    // verschobener Workspace darf ein Update nicht scheitern lassen.
    try {
      this.writeProjectFile(project);
    } catch {
      /* Workspace fehlt oder ist nicht beschreibbar — DB bleibt führend. */
    }

    return Promise.resolve(project);
  }

  /** Entfernt nur den Registry-Eintrag (+ Deploy-Ziele via ON DELETE CASCADE).
   *  Der Workspace auf der Platte bleibt erhalten — Nutzerdaten werden nie
   *  still gelöscht. */
  delete(id: string): Promise<void> {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes === 0) {
      return Promise.reject(new Error('Projekt nicht gefunden.'));
    }
    return Promise.resolve();
  }

  listTemplates(): Promise<StarterTemplate[]> {
    return Promise.resolve(loadStarterTemplates(this.templatesRoot));
  }

  /* ---------------- intern ---------------- */

  private toProject(row: ProjectRow): Project {
    const targets = this.db
      .prepare<[string], DeployTargetRow>(
        'SELECT * FROM deploy_targets WHERE project_id = ? ORDER BY position ASC',
      )
      .all(row.id);

    const project: Project = {
      id: row.id,
      name: row.name,
      workspaceDir: row.workspace_dir,
      siteDir: join(row.workspace_dir, SITE_DIRNAME),
      templateId: row.template_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deployTargets: targets.map(targetFromRow),
    };
    if (row.last_backend !== null) project.lastBackend = row.last_backend as BackendId;
    return project;
  }

  /** Findet ein freies Workspace-Verzeichnis: `<slug>`, `<slug>-2`, `<slug>-3` … */
  private uniqueWorkspaceDir(slug: string): string {
    const taken = this.db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM projects WHERE workspace_dir = ?',
    );
    for (let i = 1; ; i++) {
      const candidate = join(this.workspaceRoot, i === 1 ? slug : `${slug}-${i}`);
      const inDb = (taken.get(candidate)?.n ?? 0) > 0;
      if (!inDb && !existsSync(candidate)) return candidate;
    }
  }

  private writeProjectFile(project: Project): void {
    const contents = {
      id: project.id,
      name: project.name,
      templateId: project.templateId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      generator: 'webaibuilder',
    };
    writeFileSync(
      join(project.workspaceDir, PROJECT_FILE_NAME),
      `${JSON.stringify(contents, null, 2)}\n`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Singleton pro App-Lauf — die DB wird genau einmal geöffnet.          */
/* ------------------------------------------------------------------ */

let instance: SqliteProjectRegistry | null = null;

/** Öffnet die Registry genau einmal pro App-Lauf; weitere Aufrufe liefern
 *  dieselbe Instanz zurück. */
export function initProjectRegistry(options: ProjectRegistryOptions): SqliteProjectRegistry {
  instance ??= new SqliteProjectRegistry(options);
  return instance;
}

export function getProjectRegistry(): ProjectRegistry {
  if (instance === null) {
    throw new Error('Projekt-Registry ist noch nicht initialisiert (initProjectRegistry fehlt).');
  }
  return instance;
}
