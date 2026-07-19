/**
 * Workspace-scoped file tools for the `byok` adapter (PLAN §4).
 *
 * All tools resolve paths via {@link resolveInSite} and hard-deny anything
 * outside of `<workspaceDir>/site/`. File contents are NOT reported as an
 * event — ground truth is the chokidar watcher (packages/preview).
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { PathEscapeError, resolveInSite } from './paths';

/** Uniform error object that the model sees as a tool result. */
interface ToolError {
  ok: false;
  error: string;
}

function denied(path: string): ToolError {
  return {
    ok: false,
    error: `Access denied: "${path}" lies outside of site/. You may only edit files under site/.`,
  };
}

function relInSite(siteDir: string, abs: string): string {
  const rel = relative(siteDir, abs);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/** Minimal glob → RegExp (supports `**`, `*`, `?`, without brace expansion). */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (pattern[i + 1] === '/') i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c && '\\^$.|+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

async function walk(root: string, current: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, abs, out, limit);
    } else if (entry.isFile()) {
      out.push(relative(root, abs).split(sep).join('/'));
    }
  }
}

/** Creates the site/-bound tools for a turn. */
export function createSiteTools(siteDir: string): ToolSet {
  const read_file = tool({
    description: 'Reads a text file under site/. Path relative to site/, e.g. "index.html".',
    inputSchema: z.object({
      path: z.string().describe('Path relative to site/, e.g. "css/style.css".'),
    }),
    execute: async ({ path }) => {
      let abs: string;
      try {
        abs = await resolveInSite(siteDir, path);
      } catch (err) {
        if (err instanceof PathEscapeError) return denied(path);
        throw err;
      }
      try {
        const content = await readFile(abs, 'utf8');
        return { ok: true as const, path: relInSite(siteDir, abs), content };
      } catch {
        return { ok: false as const, error: `File "${path}" could not be read.` };
      }
    },
  });

  const write_file = tool({
    description: 'Writes (or overwrites) a text file under site/. Creates folders.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to site/, e.g. "index.html".'),
      content: z.string().describe('Complete new file content.'),
    }),
    execute: async ({ path, content }) => {
      let abs: string;
      try {
        abs = await resolveInSite(siteDir, path);
      } catch (err) {
        if (err instanceof PathEscapeError) return denied(path);
        throw err;
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      return { ok: true as const, path: relInSite(siteDir, abs), bytes: Buffer.byteLength(content) };
    },
  });

  const edit_file = tool({
    description:
      'Replaces a section of text in a file under site/ with a new one (string replace).',
    inputSchema: z.object({
      path: z.string().describe('Path relative to site/.'),
      old_string: z.string().describe('The exact text to replace.'),
      new_string: z.string().describe('The new text.'),
      replace_all: z.boolean().optional().describe('Replace all occurrences (default: only the first).'),
    }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      let abs: string;
      try {
        abs = await resolveInSite(siteDir, path);
      } catch (err) {
        if (err instanceof PathEscapeError) return denied(path);
        throw err;
      }
      let content: string;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        return { ok: false as const, error: `File "${path}" could not be read.` };
      }
      if (!content.includes(old_string)) {
        return { ok: false as const, error: `The text to replace does not occur in "${path}".` };
      }
      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);
      await writeFile(abs, updated, 'utf8');
      return { ok: true as const, path: relInSite(siteDir, abs) };
    },
  });

  const list_dir = tool({
    description: 'Lists the contents of a folder under site/.',
    inputSchema: z.object({
      path: z.string().optional().describe('Folder relative to site/ (default: site/ root).'),
    }),
    execute: async ({ path }) => {
      const target = path ?? '.';
      let abs: string;
      try {
        abs = await resolveInSite(siteDir, target);
      } catch (err) {
        if (err instanceof PathEscapeError) return denied(target);
        throw err;
      }
      try {
        const entries = await readdir(abs, { withFileTypes: true });
        return {
          ok: true as const,
          path: relInSite(siteDir, abs),
          entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
        };
      } catch {
        return { ok: false as const, error: `Folder "${target}" could not be read.` };
      }
    },
  });

  const glob = tool({
    description: 'Finds files under site/ using a glob pattern, e.g. "**/*.html".',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern relative to site/, e.g. "css/*.css".'),
    }),
    execute: async ({ pattern }) => {
      const all: string[] = [];
      try {
        const root = await resolveInSite(siteDir, '.');
        if ((await stat(root)).isDirectory()) {
          await walk(root, root, all, 5000);
        }
      } catch {
        return { ok: false as const, error: 'site/ could not be searched.' };
      }
      const rx = globToRegExp(pattern);
      const matches = all.filter((p) => rx.test(p)).slice(0, 1000);
      return { ok: true as const, pattern, matches };
    },
  });

  return { read_file, write_file, edit_file, list_dir, glob };
}

export type SiteTools = ToolSet;
