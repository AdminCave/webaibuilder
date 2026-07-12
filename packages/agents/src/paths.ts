/**
 * Pfad-Containment (harte Sicherheitsanforderung, PLAN §4).
 *
 * Alle Datei-Tools der Backends dürfen ausschließlich innerhalb von
 * `<workspaceDir>/site/` arbeiten. Wir prüfen zweistufig:
 *   1. lexikalisch (auflösen gegen die Site-Wurzel, `..`/absolute Escapes),
 *   2. per realpath (Symlink-Escapes: ein Symlink im Baum darf nicht aus
 *      site/ herausführen).
 *
 * Zielpfade müssen nicht existieren (z. B. beim Schreiben neuer Dateien):
 * wir realpath-en den tiefsten existierenden Vorfahren und hängen den noch
 * nicht existierenden Rest wieder an.
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Der aufgelöste absolute Pfad liegt außerhalb von site/. */
export class PathEscapeError extends Error {
  readonly requestedPath: string;
  constructor(requestedPath: string) {
    super(`Zugriff verweigert: "${requestedPath}" liegt außerhalb von site/.`);
    this.name = 'PathEscapeError';
    this.requestedPath = requestedPath;
  }
}

/** realpath, das auch für (noch) nicht existierende Pfade funktioniert. */
async function realpathAllowingMissing(target: string): Promise<string> {
  let current = resolve(target);
  const missingTail: string[] = [];
  // Nach oben laufen, bis ein existierender Vorfahre gefunden ist.
  for (;;) {
    try {
      const real = await realpath(current);
      return missingTail.length > 0 ? join(real, ...missingTail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Bis zur (nicht existierenden) Wurzel gelaufen — lexikalisch zurückgeben.
        return missingTail.length > 0 ? join(current, ...missingTail.reverse()) : current;
      }
      missingTail.push(basename(current));
      current = parent;
    }
  }
}

/** Prüft, ob `candidate` gleich `root` oder ein echter Nachfahre davon ist. */
function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Löst `userPath` gegen die Site-Wurzel auf und garantiert Containment.
 *
 * @param siteDir Absoluter Docroot (`<workspaceDir>/site`).
 * @param userPath Pfad wie ihn das Modell liefert (relativ zu site/ oder absolut).
 * @returns Absoluter, realpath-geprüfter Pfad innerhalb von site/.
 * @throws {PathEscapeError} wenn der Pfad site/ verlässt (lexikalisch oder via Symlink).
 */
export async function resolveInSite(siteDir: string, userPath: string): Promise<string> {
  const siteRoot = await realpathAllowingMissing(siteDir);
  // Absolute Nutzerpfade werden bewusst gegen die Site-Wurzel neu verankert,
  // damit "/index.html" als site/index.html interpretiert wird statt als
  // Systemwurzel. Echte Fremd-Absolutpfade fallen unten durch die Prüfung.
  const anchored = isAbsolute(userPath) ? join(siteRoot, `.${sep}${relative('/', userPath)}`) : resolve(siteRoot, userPath);

  // Stufe 1: lexikalische Prüfung vor jedem FS-Zugriff.
  if (!isWithin(siteRoot, anchored) && anchored !== siteRoot) {
    throw new PathEscapeError(userPath);
  }

  // Stufe 2: realpath-Prüfung (Symlink-Escape).
  const real = await realpathAllowingMissing(anchored);
  if (!isWithin(siteRoot, real) && real !== siteRoot) {
    throw new PathEscapeError(userPath);
  }
  return real;
}

/** Pfad relativ zu site/ für Anzeige-Labels, z. B. "site/index.html". */
export function siteLabel(siteDir: string, absPath: string): string {
  const rel = relative(siteDir, absPath);
  if (rel === '' || rel.startsWith('..')) return absPath;
  return `site/${rel.split(sep).join('/')}`;
}
