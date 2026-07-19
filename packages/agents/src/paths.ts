/**
 * Path containment (hard security requirement, PLAN §4).
 *
 * All of the backends' file tools may operate exclusively within
 * `<workspaceDir>/site/`. We check in two stages:
 *   1. lexically (resolve against the site root, `..`/absolute escapes),
 *   2. via realpath (symlink escapes: a symlink in the tree must not lead out
 *      of site/).
 *
 * Target paths need not exist (e.g. when writing new files): we realpath the
 * deepest existing ancestor and re-append the not-yet-existing remainder.
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The resolved absolute path lies outside of site/. */
export class PathEscapeError extends Error {
  readonly requestedPath: string;
  constructor(requestedPath: string) {
    super(`Access denied: "${requestedPath}" lies outside of site/.`);
    this.name = 'PathEscapeError';
    this.requestedPath = requestedPath;
  }
}

/** realpath that also works for (as-yet) non-existent paths. */
async function realpathAllowingMissing(target: string): Promise<string> {
  let current = resolve(target);
  const missingTail: string[] = [];
  // Walk upward until an existing ancestor is found.
  for (;;) {
    try {
      const real = await realpath(current);
      return missingTail.length > 0 ? join(real, ...missingTail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Walked up to the (non-existent) root — return lexically.
        return missingTail.length > 0 ? join(current, ...missingTail.reverse()) : current;
      }
      missingTail.push(basename(current));
      current = parent;
    }
  }
}

/** Checks whether `candidate` equals `root` or is a proper descendant of it. */
function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolves `userPath` against the site root and guarantees containment.
 *
 * @param siteDir Absolute docroot (`<workspaceDir>/site`).
 * @param userPath Path as provided by the model (relative to site/ or absolute).
 * @returns Absolute, realpath-checked path within site/.
 * @throws {PathEscapeError} when the path leaves site/ (lexically or via a symlink).
 */
export async function resolveInSite(siteDir: string, userPath: string): Promise<string> {
  const siteRoot = await realpathAllowingMissing(siteDir);
  // Absolute user paths are deliberately re-anchored against the site root, so
  // that "/index.html" is interpreted as site/index.html rather than the system
  // root. Genuine foreign absolute paths fall through the check below.
  const anchored = isAbsolute(userPath) ? join(siteRoot, `.${sep}${relative('/', userPath)}`) : resolve(siteRoot, userPath);

  // Stage 1: lexical check before any FS access.
  if (!isWithin(siteRoot, anchored) && anchored !== siteRoot) {
    throw new PathEscapeError(userPath);
  }

  // Stage 2: realpath check (symlink escape).
  const real = await realpathAllowingMissing(anchored);
  if (!isWithin(siteRoot, real) && real !== siteRoot) {
    throw new PathEscapeError(userPath);
  }
  return real;
}

/** Path relative to site/ for display labels, e.g. "site/index.html". */
export function siteLabel(siteDir: string, absPath: string): string {
  const rel = relative(siteDir, absPath);
  if (rel === '' || rel.startsWith('..')) return absPath;
  return `site/${rel.split(sep).join('/')}`;
}
