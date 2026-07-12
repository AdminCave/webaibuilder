/**
 * Starter-Vorlagen: Laden des Manifests und Kopieren in `<workspace>/site/`.
 *
 * Vorlagen sind reines statisches HTML/CSS/JS ohne Build-Schritt (PLAN §2).
 * Sie liegen unter `resources/templates/<id>/` neben einem `manifest.json`:
 * `{ "templates": [{ "id", "name", "description" }, …] }`.
 *
 * Bewusst Electron-frei: der Vorlagen-Ordner wird injiziert, damit die
 * Registry headless (vitest, Node) testbar bleibt.
 */

import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StarterTemplate } from '@webaibuilder/core';

/** Nur einfache Ordnernamen — schließt Pfad-Tricks wie "../" aus. */
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isStarterTemplate(value: unknown): value is StarterTemplate {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t['id'] === 'string' &&
    TEMPLATE_ID_PATTERN.test(t['id']) &&
    typeof t['name'] === 'string' &&
    typeof t['description'] === 'string'
  );
}

/**
 * Liest `manifest.json` und liefert nur Vorlagen, deren Ordner tatsächlich
 * eine `index.html` enthält (defekte Einträge tauchen im UI nicht auf).
 */
export function loadStarterTemplates(templatesRoot: string): StarterTemplate[] {
  const manifestPath = join(templatesRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Vorlagen-Manifest nicht gefunden: ${manifestPath}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['templates']
      : undefined;
  if (!Array.isArray(entries)) {
    throw new Error(
      `Vorlagen-Manifest ist ungültig (erwartet { "templates": [] }): ${manifestPath}`,
    );
  }
  return entries
    .filter(isStarterTemplate)
    .filter((t) => existsSync(join(templatesRoot, t.id, 'index.html')));
}

/**
 * Kopiert eine Vorlage rekursiv in das (bereits angelegte) Zielverzeichnis —
 * typischerweise `<workspace>/site/`. Wirft bei unbekannter Vorlage.
 */
export function copyTemplateInto(templatesRoot: string, templateId: string, destDir: string): void {
  if (!TEMPLATE_ID_PATTERN.test(templateId)) {
    throw new Error(`Ungültige Vorlagen-ID: "${templateId}".`);
  }
  const sourceDir = join(templatesRoot, templateId);
  if (!existsSync(join(sourceDir, 'index.html'))) {
    throw new Error(`Unbekannte Vorlage: "${templateId}".`);
  }
  cpSync(sourceDir, destDir, { recursive: true });
}
