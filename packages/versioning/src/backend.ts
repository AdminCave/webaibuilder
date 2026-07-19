/**
 * Backend selection: simple-git when a system git binary is found,
 * otherwise isomorphic-git (PLAN §4). Callers only get a GitRepo.
 */

import { execFile } from 'node:child_process';

import { IsoGitRepo } from './isoGit';
import type { GitBackendKind, GitRepo } from './repo';
import { SystemGitRepo } from './systemGit';

/** Test/escape hatch: forces a backend regardless of detection. */
const BACKEND_ENV_VAR = 'WAB_GIT_BACKEND';

let systemGitProbe: Promise<boolean> | undefined;

/** One-time, cached detection of the system git binary. */
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

/** Creates the appropriate GitRepo for a workspace (directory must exist). */
export async function repoFor(workspaceDir: string): Promise<GitRepo> {
  const kind = await resolveBackendKind();
  return kind === 'system' ? new SystemGitRepo(workspaceDir) : new IsoGitRepo(workspaceDir);
}
