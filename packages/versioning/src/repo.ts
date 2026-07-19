/**
 * Internal backend contract: a thin git abstraction behind which
 * simple-git (system git) and isomorphic-git (fallback without a git binary)
 * are interchangeable. Callers (index.ts) only know this interface.
 */

/** Which git implementation is used. */
export type GitBackendKind = 'system' | 'isomorphic';

/** Identity the app creates checkpoints/tags with (not the user). */
export const GIT_AUTHOR = {
  name: 'Web AI Builder',
  email: 'checkpoints@webaibuilder.invalid',
} as const;

/** Raw commit from `git log` (not yet interpreted as a checkpoint). */
export interface RawCommit {
  /** Full commit SHA. */
  sha: string;
  /** Author date (ISO 8601 or epoch-based; normalized later). */
  date: string;
  /** Full commit message (subject + trailers). */
  body: string;
}

/** Annotated tag incl. peeled target SHA and tag message (= version name). */
export interface RawAnnotatedTag {
  tagName: string;
  /** SHA of the commit the tag points to (peeled). */
  targetSha: string;
  /** Tag message; first line = display name of the version. */
  message: string;
}

/**
 * The flat git operations that versioning needs (PLAN §4):
 * init, add -A, commit, annotated tag, log, tree-checkout, status, rev-parse.
 */
export interface GitRepo {
  /** `git init` with branch `main`; intended to be idempotent for fresh directories. */
  init(): Promise<void>;
  /** true if HEAD points to a commit (repo not "unborn"). */
  hasCommits(): Promise<boolean>;
  /** `git add -A` — stages new, changed and deleted files. */
  addAll(): Promise<void>;
  /** Commits the index (even empty) and returns the full SHA. */
  commit(message: string): Promise<string>;
  /** Commits, newest first; empty array for a repo without commits. */
  log(maxCount?: number): Promise<RawCommit[]>;
  /** Annotated tag on `targetSha`; `message` carries the version name. */
  createAnnotatedTag(tagName: string, targetSha: string, message: string): Promise<void>;
  /** All annotated tags (lightweight tags are ignored). */
  listAnnotatedTags(): Promise<RawAnnotatedTag[]>;
  /** All tag names (incl. lightweight) — for collision checking. */
  listTagNames(): Promise<string[]>;
  /** true if working directory/index differ from HEAD (incl. untracked). */
  isDirty(): Promise<boolean>;
  /**
   * Sets working directory + index to the tree of `sha` — including
   * deleting files that don't exist in the target. HEAD stays untouched
   * (no detached HEAD; the restore commit happens afterward).
   */
  restoreTree(sha: string): Promise<void>;
  /** Resolves a ref/short SHA to a full commit SHA (throws otherwise). */
  resolveCommit(ref: string): Promise<string>;
  /** Full SHA of HEAD (throws for a repo without commits). */
  headSha(): Promise<string>;
}
