/**
 * Versionierung (PLAN §4): echtes git pro Workspace (simple-git, Fallback
 * isomorphic-git). Das UI sagt nie "git" — nach außen sind es Checkpoints.
 *
 * - Checkpoint pro Agent-Turn: Commit mit erster Prompt-Zeile; Trailer:
 *   Turn-ID, Backend, Session, Kosten.
 * - Benannte Versionen: annotated Tags + Anzeigename in der DB.
 * - Restore-als-neuer-Commit: linear, verlustfrei, kein detached HEAD;
 *   dirty state wird vorher auto-checkpointed.
 *
 * Electron-frei — dieses Paket darf niemals `electron` importieren.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Checkpoint } from '@webaibuilder/core';

import { repoFor } from './backend';
import { buildCommitMessage, firstLine, parseCheckpoint, type CheckpointMeta } from './message';
import type { GitRepo } from './repo';

export type { CheckpointMeta } from './message';

/** Ergebnis von {@link nameVersion}: Tag ↔ Checkpoint ↔ Anzeigename. */
export interface NamedVersion {
  /** Commit-SHA des benannten Checkpoints. */
  sha: string;
  /** Ref-Name des annotated Tags im Repo (z. B. "wab/erste-version"). */
  tagName: string;
  /** Anzeigename (liegt zusätzlich in der DB; hier auch in der Tag-Message). */
  name: string;
}

/** .gitignore für einen Static-Site-Workspace. project.json ist App-Metadatum
 *  (Registry/Deploy-Ziele) und gehört nicht in die Checkpoints — sonst würde
 *  ein Restore auch Deploy-Einstellungen zurückdrehen. */
const WORKSPACE_GITIGNORE = `# Von Web AI Builder verwaltet — bitte nicht löschen.

# App-Metadaten (liegen in der Projekt-Registry, nicht in den Checkpoints)
project.json

# Betriebssystem-Artefakte
.DS_Store
Thumbs.db
desktop.ini

# Temporäres & Logs
*.log
.wab-tmp/
node_modules/
`;

/** Öffnet das Workspace-Repo; wirft, wenn noch keins existiert. */
async function openRepo(workspaceDir: string): Promise<GitRepo> {
  if (!existsSync(join(workspaceDir, '.git'))) {
    throw new Error(
      `Für dieses Projekt ist noch keine Versionierung eingerichtet (${workspaceDir}).`,
    );
  }
  return repoFor(workspaceDir);
}

/** Löst eine Checkpoint-ID (volle/kurze SHA) auf oder wirft verständlich. */
async function resolveCheckpointId(repo: GitRepo, checkpointId: string): Promise<string> {
  try {
    return await repo.resolveCommit(checkpointId);
  } catch {
    throw new Error(`Den Checkpoint "${checkpointId}" gibt es in diesem Projekt nicht.`);
  }
}

/** Liest den HEAD-Commit als Checkpoint zurück (nach commit/restore). */
async function headCheckpoint(repo: GitRepo): Promise<Checkpoint> {
  const [head] = await repo.log(1);
  if (!head) {
    throw new Error('Dieses Projekt hat noch keinen Checkpoint.');
  }
  return parseCheckpoint(head);
}

/** Macht aus einem Anzeigenamen einen git-ref-sicheren Tag-Slug. */
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
 * Initialisiert das Workspace-Repo (`~/WebAIBuilder/<projekt>/.git`):
 * legt das Repo an (falls es fehlt), schreibt eine .gitignore für den
 * Static-Site-Workspace und erstellt den Erst-Commit, wenn das Repo leer ist.
 * Idempotent — mehrfacher Aufruf ist unschädlich.
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
    await repo.commit('Projekt angelegt');
  }
}

/**
 * Legt einen Checkpoint an: `add -A` + Commit. Subject = erste Zeile von
 * `message` (die Prompt-Zeile), Turn-Metadaten aus `meta` als git-Trailer.
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
 * Listet Checkpoints für die Timeline (neueste zuerst) — inkl. Trailer-
 * Metadaten und `versionName` aus annotated Tags.
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
 * Stellt einen Checkpoint wieder her — als NEUER Commit (linear, verlustfrei,
 * kein detached HEAD):
 * 1. dirty state → "Automatischer Checkpoint vor Wiederherstellung"
 * 2. Ziel-Baum über das Arbeitsverzeichnis auschecken (HEAD bleibt auf main)
 * 3. Commit "Wiederhergestellt: <Name oder Kurz-SHA>"
 */
export async function restoreCheckpoint(
  workspaceDir: string,
  checkpointId: string,
): Promise<Checkpoint> {
  const repo = await openRepo(workspaceDir);
  const targetSha = await resolveCheckpointId(repo, checkpointId);

  if (await repo.isDirty()) {
    await repo.addAll();
    await repo.commit('Automatischer Checkpoint vor Wiederherstellung');
  }

  const tags = await repo.listAnnotatedTags();
  const named = tags.find((tag) => tag.targetSha === targetSha);
  const label = (named && firstLine(named.message)) || targetSha.slice(0, 7);

  await repo.restoreTree(targetSha);
  await repo.commit(`Wiederhergestellt: ${label}`);
  return headCheckpoint(repo);
}

/**
 * Benennt einen Checkpoint als Version: annotated Tag, der Anzeigename steht
 * in der Tag-Message (und zusätzlich in der DB — das macht der Aufrufer).
 */
export async function nameVersion(
  workspaceDir: string,
  checkpointId: string,
  name: string,
): Promise<NamedVersion> {
  const repo = await openRepo(workspaceDir);
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Gib der Version einen Namen.');
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
 * Volle SHA des aktuellen HEAD — z. B. für den "Deployed"-Abgleich
 * (den Abgleich selbst macht packages/deploy).
 */
export async function currentSha(workspaceDir: string): Promise<string> {
  const repo = await openRepo(workspaceDir);
  try {
    return await repo.headSha();
  } catch {
    throw new Error('Dieses Projekt hat noch keinen Checkpoint.');
  }
}
