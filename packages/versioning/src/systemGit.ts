/**
 * GitRepo implementation via the system git binary (simple-git).
 * Preferred when a git binary is found — faster and
 * 1:1 compatible with what users see with normal git.
 */

import { simpleGit, type SimpleGit } from 'simple-git';

import { GIT_AUTHOR, type GitRepo, type RawAnnotatedTag, type RawCommit } from './repo';

/** Field/record separators for machine-readable `git log`/`for-each-ref`. */
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export class SystemGitRepo implements GitRepo {
  private readonly git: SimpleGit;

  constructor(workspaceDir: string) {
    this.git = simpleGit({
      baseDir: workspaceDir,
      // Checkpoints are created by the app, not the user — fixed
      // identity, no signing (global gpgsign configs would otherwise
      // block commits in workspaces).
      config: [
        `user.name=${GIT_AUTHOR.name}`,
        `user.email=${GIT_AUTHOR.email}`,
        'commit.gpgsign=false',
        'tag.gpgsign=false',
      ],
    });
  }

  async init(): Promise<void> {
    await this.git.raw(['init']);
    // Branch name deterministically set to `main`, independent of the user's
    // init.defaultBranch — but only while the repo has no commit yet.
    if (!(await this.hasCommits())) {
      await this.git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    }
  }

  async hasCommits(): Promise<boolean> {
    // No --quiet: simple-git detects errors only from stderr output —
    // with --quiet, rev-parse on a repo without commits appears to "succeed".
    try {
      const out = await this.git.raw(['rev-parse', '--verify', 'HEAD']);
      return FULL_SHA_RE.test(out.trim());
    } catch {
      return false;
    }
  }

  async addAll(): Promise<void> {
    await this.git.raw(['add', '--all']);
  }

  async commit(message: string): Promise<string> {
    // --allow-empty: one checkpoint per agent turn, even if the turn changed
    // nothing — the timeline stays 1:1 with the turns.
    await this.git.raw(['commit', '--allow-empty', '--no-verify', '-m', message]);
    return this.headSha();
  }

  async log(maxCount?: number): Promise<RawCommit[]> {
    const args = ['log', `--format=%H%x1f%aI%x1f%B%x1e`];
    if (maxCount !== undefined) {
      args.push('-n', String(maxCount));
    }
    let out: string;
    try {
      out = await this.git.raw(args);
    } catch {
      // Repo without commits ("does not have any commits yet")
      return [];
    }
    const commits: RawCommit[] = [];
    for (const record of out.split(RECORD_SEP)) {
      const trimmed = record.replace(/^\s+/, '');
      if (trimmed.length === 0) continue;
      const [sha = '', date = '', body = ''] = trimmed.split(FIELD_SEP);
      if (sha.length > 0) {
        commits.push({ sha, date, body: body.replace(/\s+$/, '') });
      }
    }
    return commits;
  }

  async createAnnotatedTag(tagName: string, targetSha: string, message: string): Promise<void> {
    await this.git.raw(['tag', '-a', tagName, '-m', message, targetSha]);
  }

  async listAnnotatedTags(): Promise<RawAnnotatedTag[]> {
    // %(objectname) = tag object, %(*objectname) = peeled commit (only filled
    // for annotated tags), %(contents:subject) = first line of the message.
    const out = await this.git.raw([
      'for-each-ref',
      'refs/tags',
      `--format=%(refname:short)%1f%(objectname)%1f%(*objectname)%1f%(contents:subject)%1e`,
    ]);
    const tags: RawAnnotatedTag[] = [];
    for (const record of out.split(RECORD_SEP)) {
      const trimmed = record.replace(/^\s+/, '');
      if (trimmed.length === 0) continue;
      const [tagName = '', , peeledSha = '', subject = ''] = trimmed.split(FIELD_SEP);
      if (tagName.length > 0 && peeledSha.length > 0) {
        tags.push({ tagName, targetSha: peeledSha, message: subject });
      }
    }
    return tags;
  }

  async listTagNames(): Promise<string[]> {
    const out = await this.git.raw(['tag', '--list']);
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async isDirty(): Promise<boolean> {
    const status = await this.git.status();
    return !status.isClean();
  }

  async restoreTree(sha: string): Promise<void> {
    // read-tree --reset -u: index := target tree, working directory is
    // adjusted (incl. deleting files that no longer exist). HEAD stays
    // on the branch — no detached HEAD.
    await this.git.raw(['read-tree', '--reset', '-u', sha]);
  }

  async resolveCommit(ref: string): Promise<string> {
    // No --quiet (see hasCommits); additionally validate the result.
    const out = await this.git.raw(['rev-parse', '--verify', `${ref}^{commit}`]);
    const sha = out.trim();
    if (!FULL_SHA_RE.test(sha)) {
      throw new Error(`No commit SHA for "${ref}".`);
    }
    return sha;
  }

  async headSha(): Promise<string> {
    const out = await this.git.raw(['rev-parse', 'HEAD']);
    return out.trim();
  }
}
