/**
 * Versioning (PLAN §4): real git per workspace (simple-git, fallback
 * isomorphic-git). The UI never says "git" — externally these are checkpoints.
 *
 * - Checkpoint per agent turn: commit with the first prompt line; trailers:
 *   turn ID, backend, session, cost.
 * - Named versions: annotated tags + display name in the DB.
 * - Restore-as-new-commit: linear, lossless, no detached HEAD;
 *   dirty state is auto-checkpointed beforehand.
 *
 * Electron-free — this package must never import `electron`.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Checkpoint } from '@webaibuilder/core';

import { repoFor } from './backend';
import { buildCommitMessage, firstLine, parseCheckpoint, type CheckpointMeta } from './message';
import type { GitRepo } from './repo';

export type { CheckpointMeta } from './message';

/** Result of {@link nameVersion}: tag ↔ checkpoint ↔ display name. */
export interface NamedVersion {
  /** Commit SHA of the named checkpoint. */
  sha: string;
  /** Ref name of the annotated tag in the repo (e.g. "wab/first-version"). */
  tagName: string;
  /** Display name (also stored in the DB; here also in the tag message). */
  name: string;
}

/** .gitignore for a static-site workspace. project.json is app metadata
 *  (registry/deploy targets) and does not belong in the checkpoints — otherwise
 *  a restore would also roll back deploy settings. */
const WORKSPACE_GITIGNORE = `# Managed by Web AI Builder — please do not delete.

# App metadata (lives in the project registry, not in the checkpoints)
project.json

# Operating-system artifacts
.DS_Store
Thumbs.db
desktop.ini

# Temporary & logs
*.log
.wab-tmp/
node_modules/
`;

/** Opens the workspace repo; throws if none exists yet. */
async function openRepo(workspaceDir: string): Promise<GitRepo> {
  if (!existsSync(join(workspaceDir, '.git'))) {
    throw new Error(
      `Versioning is not set up for this project yet (${workspaceDir}).`,
    );
  }
  return repoFor(workspaceDir);
}

/** Resolves a checkpoint ID (full/short SHA) or throws a clear error. */
async function resolveCheckpointId(repo: GitRepo, checkpointId: string): Promise<string> {
  try {
    return await repo.resolveCommit(checkpointId);
  } catch {
    throw new Error(`The checkpoint "${checkpointId}" does not exist in this project.`);
  }
}

/** Reads back the HEAD commit as a checkpoint (after commit/restore). */
async function headCheckpoint(repo: GitRepo): Promise<Checkpoint> {
  const [head] = await repo.log(1);
  if (!head) {
    throw new Error('This project has no checkpoint yet.');
  }
  return parseCheckpoint(head);
}

/** Turns a display name into a git-ref-safe tag slug. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'version';
}

/**
 * Initializes the workspace repo (`~/WebAIBuilder/<project>/.git`):
 * creates the repo (if missing), writes a .gitignore for the
 * static-site workspace and makes the initial commit if the repo is empty.
 * Idempotent — calling it multiple times is harmless.
 */
export async function initWorkspace(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
  const repo = await repoFor(workspaceDir);
  if (!existsSync(join(workspaceDir, '.git'))) {
    await repo.init();
  }
  const gitignorePath = join(workspaceDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, WORKSPACE_GITIGNORE, 'utf8');
  }
  if (!(await repo.hasCommits())) {
    await repo.addAll();
    await repo.commit('Project created');
  }
}

/**
 * Creates a checkpoint: `add -A` + commit. Subject = first line of
 * `message` (the prompt line), turn metadata from `meta` as git trailers.
 */
export async function createCheckpoint(
  workspaceDir: string,
  message: string,
  meta?: CheckpointMeta,
): Promise<Checkpoint> {
  const repo = await openRepo(workspaceDir);
  const subject = firstLine(message) || 'Checkpoint';
  await repo.addAll();
  await repo.commit(buildCommitMessage(subject, meta));
  return headCheckpoint(repo);
}

/**
 * Lists checkpoints for the timeline (newest first) — incl. trailer
 * metadata and `versionName` from annotated tags.
 */
export async function listCheckpoints(workspaceDir: string): Promise<Checkpoint[]> {
  const repo = await openRepo(workspaceDir);
  const [commits, tags] = await Promise.all([repo.log(), repo.listAnnotatedTags()]);
  const nameBySha = new Map<string, string>();
  for (const tag of tags) {
    if (!nameBySha.has(tag.targetSha)) {
      nameBySha.set(tag.targetSha, firstLine(tag.message));
    }
  }
  return commits.map((commit) => parseCheckpoint(commit, nameBySha.get(commit.sha)));
}

/**
 * Restores a checkpoint — as a NEW commit (linear, lossless,
 * no detached HEAD):
 * 1. dirty state → "Automatic checkpoint before restore"
 * 2. check out the target tree over the working directory (HEAD stays on main)
 * 3. commit "Restored: <name or short SHA>"
 */
export async function restoreCheckpoint(
  workspaceDir: string,
  checkpointId: string,
): Promise<Checkpoint> {
  const repo = await openRepo(workspaceDir);
  const targetSha = await resolveCheckpointId(repo, checkpointId);

  if (await repo.isDirty()) {
    await repo.addAll();
    await repo.commit('Automatic checkpoint before restore');
  }

  const tags = await repo.listAnnotatedTags();
  const named = tags.find((tag) => tag.targetSha === targetSha);
  const label = (named && firstLine(named.message)) || targetSha.slice(0, 7);

  await repo.restoreTree(targetSha);
  await repo.commit(`Restored: ${label}`);
  return headCheckpoint(repo);
}

/**
 * Names a checkpoint as a version: annotated tag, the display name is stored
 * in the tag message (and additionally in the DB — the caller does that).
 */
export async function nameVersion(
  workspaceDir: string,
  checkpointId: string,
  name: string,
): Promise<NamedVersion> {
  const repo = await openRepo(workspaceDir);
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Give the version a name.');
  }
  const sha = await resolveCheckpointId(repo, checkpointId);
  const existing = new Set(await repo.listTagNames());
  const base = `wab/${slugify(trimmed)}`;
  let tagName = base;
  for (let suffix = 2; existing.has(tagName); suffix += 1) {
    tagName = `${base}-${suffix}`;
  }
  await repo.createAnnotatedTag(tagName, sha, trimmed);
  return { sha, tagName, name: trimmed };
}

/**
 * Full SHA of the current HEAD — e.g. for the "deployed" comparison
 * (the comparison itself is done by packages/deploy).
 */
export async function currentSha(workspaceDir: string): Promise<string> {
  const repo = await openRepo(workspaceDir);
  try {
    return await repo.headSha();
  } catch {
    throw new Error('This project has no checkpoint yet.');
  }
}
