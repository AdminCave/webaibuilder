/**
 * Project registry — persistent with better-sqlite3 (M1).
 *
 * Implements the `ProjectRegistry` contract from @webaibuilder/core:
 * create/list/get/update/delete + template list. `create` creates the workspace
 * (`~/WebAIBuilder/<slug>/` with a `site/` docroot and `project.json`) and
 * populates `site/` from a starter template.
 *
 * Deliberately electron-free: the DB path, workspace root, and templates folder
 * are injected (headless testable with vitest). The electron wiring
 * (`app.getPath('userData')` etc.) lives in `paths.ts` and runs only at app
 * runtime.
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
  /** Absolute path of the SQLite file, e.g. `<userData>/webaibuilder.db`. */
  dbPath: string;
  /** Root for project workspaces, e.g. `~/WebAIBuilder`. */
  workspaceRoot: string;
  /** Folder with `manifest.json` + templates, e.g. `resources/templates`. */
  templatesRoot: string;
}

/* ------------------------------------------------------------------ */
/* Migrations — a simple version table so the schema can grow.        */
/* ------------------------------------------------------------------ */

const MIGRATIONS: readonly string[] = [
  // v1: projects + deploy targets (incl. deployed commit SHA per target, PLAN §4).
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
/* Row types                                                           */
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

/** Slug for the workspace directory: `~/WebAIBuilder/<slug>/`. */
function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'project' : slug;
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
      return Promise.reject(new Error('The project name must not be empty.'));
    }

    // Check the template BEFORE creating any directories — an unknown template
    // must leave behind neither files nor DB rows.
    const templates = loadStarterTemplates(this.templatesRoot);
    if (!templates.some((t) => t.id === input.templateId)) {
      return Promise.reject(new Error(`Unknown template: "${input.templateId}".`));
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

    // Create the workspace and populate it from the template (throws on an
    // unknown template, BEFORE anything is written to the DB).
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
      return Promise.reject(new Error('Project not found.'));
    }

    const name = patch.name?.trim();
    if (name !== undefined && name === '') {
      return Promise.reject(new Error('The project name must not be empty.'));
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
      return Promise.reject(new Error('Project not found.'));
    }
    const project = this.toProject(updatedRow);

    // Keep project.json in the workspace in sync — best effort: a manually moved
    // workspace must not cause an update to fail.
    try {
      this.writeProjectFile(project);
    } catch {
      /* Workspace missing or not writable — the DB remains authoritative. */
    }

    return Promise.resolve(project);
  }

  /** Removes only the registry entry (+ deploy targets via ON DELETE CASCADE).
   *  The workspace on disk is retained — user data is never silently
   *  deleted. */
  delete(id: string): Promise<void> {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes === 0) {
      return Promise.reject(new Error('Project not found.'));
    }
    return Promise.resolve();
  }

  listTemplates(): Promise<StarterTemplate[]> {
    return Promise.resolve(loadStarterTemplates(this.templatesRoot));
  }

  /* ---------------- internal ---------------- */

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

  /** Finds a free workspace directory: `<slug>`, `<slug>-2`, `<slug>-3` … */
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
/* Singleton per app run — the DB is opened exactly once.             */
/* ------------------------------------------------------------------ */

let instance: SqliteProjectRegistry | null = null;

/** Opens the registry exactly once per app run; further calls return the same
 *  instance. */
export function initProjectRegistry(options: ProjectRegistryOptions): SqliteProjectRegistry {
  instance ??= new SqliteProjectRegistry(options);
  return instance;
}

export function getProjectRegistry(): ProjectRegistry {
  if (instance === null) {
    throw new Error('Project registry is not yet initialized (initProjectRegistry missing).');
  }
  return instance;
}
