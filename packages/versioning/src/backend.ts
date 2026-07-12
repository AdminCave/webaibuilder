/**
 * Backend-Wahl: simple-git, wenn ein System-git-Binary gefunden wird,
 * sonst isomorphic-git (PLAN §4). Aufrufer bekommen nur ein GitRepo.
 */

import { execFile } from 'node:child_process';

import { IsoGitRepo } from './isoGit';
import type { GitBackendKind, GitRepo } from './repo';
import { SystemGitRepo } from './systemGit';

/** Test-/Notausgang: erzwingt ein Backend unabhängig von der Erkennung. */
const BACKEND_ENV_VAR = 'WAB_GIT_BACKEND';

let systemGitProbe: Promise<boolean> | undefined;

/** Einmalige, gecachte Erkennung des System-git-Binaries. */
function hasSystemGit(): Promise<boolean> {
  systemGitProbe ??= new Promise((resolve) => {
    execFile('git', ['--version'], (error) => {
      resolve(error === null);
    });
  });
  return systemGitProbe;
}

export async function resolveBackendKind(): Promise<GitBackendKind> {
  const override = process.env[BACKEND_ENV_VAR];
  if (override === 'system' || override === 'isomorphic') {
    return override;
  }
  return (await hasSystemGit()) ? 'system' : 'isomorphic';
}

/** Erstellt das passende GitRepo für einen Workspace (Verzeichnis muss existieren). */
export async function repoFor(workspaceDir: string): Promise<GitRepo> {
  const kind = await resolveBackendKind();
  return kind === 'system' ? new SystemGitRepo(workspaceDir) : new IsoGitRepo(workspaceDir);
}
