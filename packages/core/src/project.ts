/**
 * Workspace and project types (PLAN §4, workspace layout):
 * `~/WebAIBuilder/<project>/` with `site/` (docroot), `.git/`, `project.json`.
 */

import type { BackendId } from './agent';

export const WORKSPACE_ROOT_DIRNAME = 'WebAIBuilder';
export const SITE_DIRNAME = 'site';
export const PROJECT_FILE_NAME = 'project.json';

export type DeployProtocol = 'sftp' | 'ftp' | 'ftps';

/** A deploy target (classic web hosting). Secrets are NEVER stored here — only a
 *  reference to the OS keychain (PLAN §4, deploy engine). */
export interface DeployTarget {
  id: string;
  /** Display name, e.g. "IONOS club site". */
  name: string;
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  /** Target directory on the server, e.g. "/htdocs". */
  remotePath: string;
  /** Reference to the secret in the OS keychain (@napi-rs/keyring). */
  credentialRef: string;
  /** Commit SHA from the remote manifest (`.wab-manifest.json`) — "which
   *  version is deployed on this target" (PLAN §4). */
  lastDeployedCommit?: string;
  lastDeployedAt?: string;
}

/** A checkpoint = a commit in the workspace git (the UI never says "git"). */
export interface Checkpoint {
  /** Commit SHA. */
  id: string;
  /** First prompt line of the turn, or a manual description. */
  message: string;
  createdAt: string;
  /** Trailer metadata of the agent turn (PLAN §4, versioning). */
  turnId?: string;
  backend?: BackendId;
  sessionId?: string;
  costUsd?: number;
  /** Display name, if tagged as a named version (annotated tag). */
  versionName?: string;
  /** true if this SHA appears in the remote manifest of a deploy target. */
  deployed?: boolean;
}

/** A starter template for new projects (static HTML/CSS/JS, PLAN §2). */
export interface StarterTemplate {
  /** Folder name under resources/templates, e.g. "einseiter". */
  id: string;
  /** Display name, e.g. "One-Pager". */
  name: string;
  /** Short description for the new-project form. */
  description: string;
}

/** A project in the registry (contents of `project.json` + runtime fields). */
export interface Project {
  id: string;
  name: string;
  /** Absolute path: `~/WebAIBuilder/<project>`. */
  workspaceDir: string;
  /** Absolute path of the docroot: `<workspaceDir>/site`. */
  siteDir: string;
  /** Template the project was created from. */
  templateId: string;
  createdAt: string;
  updatedAt: string;
  /** Last used AI backend. */
  lastBackend?: BackendId;
  deployTargets: DeployTarget[];
}

export interface ProjectCreateInput {
  name: string;
  /** Starter template (`StarterTemplate.id`) used to populate `site/`. */
  templateId: string;
}

/** Partial update — only set fields are changed. `deployTargets`
 *  replaces the entire list (incl. `lastDeployedCommit` per target). */
export interface ProjectUpdateInput {
  name?: string;
  lastBackend?: BackendId;
  deployTargets?: DeployTarget[];
}

/**
 * Project registry contract. Implemented in the Electron main process with
 * better-sqlite3 (`apps/desktop/src/main/registry.ts`); DB path, workspace
 * root and templates folder are injectable (headless-testable).
 */
export interface ProjectRegistry {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  /** Creates workspace + `site/` + `project.json` and copies the template. */
  create(input: ProjectCreateInput): Promise<Project>;
  update(id: string, patch: ProjectUpdateInput): Promise<Project>;
  /** Removes the project from the registry; the workspace on disk
   *  is intentionally kept (user data is never silently deleted). */
  delete(id: string): Promise<void>;
  /** Available starter templates for the new-project form. */
  listTemplates(): Promise<StarterTemplate[]>;
}
