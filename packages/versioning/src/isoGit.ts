/**
 * GitRepo implementation via isomorphic-git (pure JS) — fallback for
 * systems without a git binary. Must be byte-compatible with SystemGitRepo:
 * both write/read the same repo format.
 */

import fs from 'node:fs';

import git from 'isomorphic-git';

import { GIT_AUTHOR, type GitRepo, type RawAnnotatedTag, type RawCommit } from './repo';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
const SHORT_SHA_RE = /^[0-9a-f]{4,39}$/i;

export class IsoGitRepo implements GitRepo {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await git.init({ fs, dir: this.dir, defaultBranch: 'main' });
    // Set a local identity so the repo stays usable with a normal git binary
    // without a global config (the user is allowed to open it, PLAN §4).
    await git.setConfig({ fs, dir: this.dir, path: 'user.name', value: GIT_AUTHOR.name });
    await git.setConfig({ fs, dir: this.dir, path: 'user.email', value: GIT_AUTHOR.email });
  }

  async hasCommits(): Promise<boolean> {
    try {
      await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' });
      return true;
    } catch {
      return false;
    }
  }

  async addAll(): Promise<void> {
    // "add -A" equivalent: remove deleted files from the index,
    // stage everything else (new/changed/unchanged).
    const matrix = await git.statusMatrix({ fs, dir: this.dir });
    const toAdd: string[] = [];
    for (const [filepath, , worktreeStatus] of matrix) {
      if (worktreeStatus === 0) {
        await git.remove({ fs, dir: this.dir, filepath });
      } else {
        toAdd.push(filepath);
      }
    }
    if (toAdd.length > 0) {
      await git.add({ fs, dir: this.dir, filepath: toAdd });
    }
  }

  async commit(message: string): Promise<string> {
    // isomorphic-git commits the index even without changes — equivalent to
    // `--allow-empty` (checkpoint per turn, see SystemGitRepo).
    return git.commit({ fs, dir: this.dir, message, author: { ...GIT_AUTHOR } });
  }

  async log(maxCount?: number): Promise<RawCommit[]> {
    let entries;
    try {
      entries = await git.log({ fs, dir: this.dir, ref: 'HEAD', depth: maxCount });
    } catch {
      // Repo without commits
      return [];
    }
    return entries.map((entry) => ({
      sha: entry.oid,
      date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
      body: entry.commit.message.replace(/\s+$/, ''),
    }));
  }

  async createAnnotatedTag(tagName: string, targetSha: string, message: string): Promise<void> {
    await git.annotatedTag({
      fs,
      dir: this.dir,
      ref: tagName,
      object: targetSha,
      message,
      tagger: { ...GIT_AUTHOR },
    });
  }

  async listAnnotatedTags(): Promise<RawAnnotatedTag[]> {
    const names = await git.listTags({ fs, dir: this.dir });
    const tags: RawAnnotatedTag[] = [];
    for (const tagName of names) {
      const oid = await git.resolveRef({ fs, dir: this.dir, ref: `refs/tags/${tagName}` });
      try {
        const { tag } = await git.readTag({ fs, dir: this.dir, oid });
        if (tag.type === 'commit') {
          tags.push({ tagName, targetSha: tag.object, message: tag.message });
        }
      } catch {
        // Lightweight tag (points directly at a commit) — not a named version.
      }
    }
    return tags;
  }

  async listTagNames(): Promise<string[]> {
    return git.listTags({ fs, dir: this.dir });
  }

  async isDirty(): Promise<boolean> {
    const matrix = await git.statusMatrix({ fs, dir: this.dir });
    return matrix.some(([, head, workdir, stage]) => head !== 1 || workdir !== 1 || stage !== 1);
  }

  async restoreTree(sha: string): Promise<void> {
    // force + noUpdateHead: working directory and index are set to the
    // target tree (incl. deletions), HEAD stays on the branch.
    await git.checkout({ fs, dir: this.dir, ref: sha, force: true, noUpdateHead: true });
  }

  async resolveCommit(ref: string): Promise<string> {
    let oid: string;
    if (FULL_SHA_RE.test(ref)) {
      oid = ref.toLowerCase();
    } else if (SHORT_SHA_RE.test(ref)) {
      oid = await git.expandOid({ fs, dir: this.dir, oid: ref.toLowerCase() });
    } else {
      oid = await git.resolveRef({ fs, dir: this.dir, ref });
    }
    try {
      await git.readCommit({ fs, dir: this.dir, oid });
      return oid;
    } catch {
      // Possibly an annotated tag object — peel once.
      const { tag } = await git.readTag({ fs, dir: this.dir, oid });
      await git.readCommit({ fs, dir: this.dir, oid: tag.object });
      return tag.object;
    }
  }

  async headSha(): Promise<string> {
    return git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' });
  }
}
