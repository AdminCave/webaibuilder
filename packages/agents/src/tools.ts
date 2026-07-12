/**
 * Workspace-scoped Datei-Tools für den `byok`-Adapter (PLAN §4).
 *
 * Alle Tools lösen Pfade über {@link resolveInSite} auf und verweigern hart
 * alles außerhalb von `<workspaceDir>/site/`. Datei-Inhalte werden NICHT als
 * Event gemeldet — ground truth ist der chokidar-Watcher (packages/preview).
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { PathEscapeError, resolveInSite } from './paths';

/** Einheitliches Fehlerobjekt, das das Modell als Tool-Ergebnis sieht. */
interface ToolError {
  ok: false;
  error: string;
}

function denied(path: string): ToolError {
  return {
    ok: false,
    error: `Zugriff verweigert: "${path}" liegt außerhalb von site/. Du darfst nur Dateien unter site/ bearbeiten.`,
  };
}

function relInSite(siteDir: string, abs: string): string {
  const rel = relative(siteDir, abs);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/** Minimaler Glob → RegExp (unterstützt `**`, `*`, `?`, ohne Brace-Expansion). */
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

/** Erzeugt die site/-gebundenen Tools für einen Turn. */
export function createSiteTools(siteDir: string): ToolSet {
  const read_file = tool({
    description: 'Liest eine Textdatei unter site/. Pfad relativ zu site/, z. B. "index.html".',
    inputSchema: z.object({
      path: z.string().describe('Pfad relativ zu site/, z. B. "css/style.css".'),
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
        return { ok: false as const, error: `Datei "${path}" konnte nicht gelesen werden.` };
      }
    },
  });

  const write_file = tool({
    description: 'Schreibt (oder überschreibt) eine Textdatei unter site/. Legt Ordner an.',
    inputSchema: z.object({
      path: z.string().describe('Pfad relativ zu site/, z. B. "index.html".'),
      content: z.string().describe('Vollständiger neuer Dateiinhalt.'),
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
      'Ersetzt in einer Datei unter site/ einen Textabschnitt durch einen neuen (String-Replace).',
    inputSchema: z.object({
      path: z.string().describe('Pfad relativ zu site/.'),
      old_string: z.string().describe('Der exakt zu ersetzende Text.'),
      new_string: z.string().describe('Der neue Text.'),
      replace_all: z.boolean().optional().describe('Alle Vorkommen ersetzen (Standard: nur das erste).'),
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
        return { ok: false as const, error: `Datei "${path}" konnte nicht gelesen werden.` };
      }
      if (!content.includes(old_string)) {
        return { ok: false as const, error: `Der zu ersetzende Text kommt in "${path}" nicht vor.` };
      }
      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);
      await writeFile(abs, updated, 'utf8');
      return { ok: true as const, path: relInSite(siteDir, abs) };
    },
  });

  const list_dir = tool({
    description: 'Listet den Inhalt eines Ordners unter site/ auf.',
    inputSchema: z.object({
      path: z.string().optional().describe('Ordner relativ zu site/ (Standard: site/-Wurzel).'),
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
        return { ok: false as const, error: `Ordner "${target}" konnte nicht gelesen werden.` };
      }
    },
  });

  const glob = tool({
    description: 'Findet Dateien unter site/ per Glob-Muster, z. B. "**/*.html".',
    inputSchema: z.object({
      pattern: z.string().describe('Glob-Muster relativ zu site/, z. B. "css/*.css".'),
    }),
    execute: async ({ pattern }) => {
      const all: string[] = [];
      try {
        const root = await resolveInSite(siteDir, '.');
        if ((await stat(root)).isDirectory()) {
          await walk(root, root, all, 5000);
        }
      } catch {
        return { ok: false as const, error: 'site/ konnte nicht durchsucht werden.' };
      }
      const rx = globToRegExp(pattern);
      const matches = all.filter((p) => rx.test(p)).slice(0, 1000);
      return { ok: true as const, pattern, matches };
    },
  });

  return { read_file, write_file, edit_file, list_dir, glob };
}

export type SiteTools = ToolSet;
