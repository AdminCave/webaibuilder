/**
 * Starter templates: loading the manifest and copying into `<workspace>/site/`.
 *
 * Templates are pure static HTML/CSS/JS with no build step (PLAN §2). They live
 * under `resources/templates/<id>/` next to a `manifest.json`:
 * `{ "templates": [{ "id", "name", "description" }, …] }`.
 *
 * Deliberately electron-free: the templates folder is injected so the registry
 * stays headless (vitest, Node) testable.
 */

import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StarterTemplate } from '@webaibuilder/core';

/** Simple folder names only — rules out path tricks like "../". */
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
 * Reads `manifest.json` and returns only templates whose folder actually
 * contains an `index.html` (broken entries do not appear in the UI).
 */
export function loadStarterTemplates(templatesRoot: string): StarterTemplate[] {
  const manifestPath = join(templatesRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Templates manifest not found: ${manifestPath}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['templates']
      : undefined;
  if (!Array.isArray(entries)) {
    throw new Error(
      `Templates manifest is invalid (expected { "templates": [] }): ${manifestPath}`,
    );
  }
  return entries
    .filter(isStarterTemplate)
    .filter((t) => existsSync(join(templatesRoot, t.id, 'index.html')));
}

/**
 * Copies a template recursively into the (already created) destination directory
 * — typically `<workspace>/site/`. Throws on an unknown template.
 */
export function copyTemplateInto(templatesRoot: string, templateId: string, destDir: string): void {
  if (!TEMPLATE_ID_PATTERN.test(templateId)) {
    throw new Error(`Invalid template ID: "${templateId}".`);
  }
  const sourceDir = join(templatesRoot, templateId);
  if (!existsSync(join(sourceDir, 'index.html'))) {
    throw new Error(`Unknown template: "${templateId}".`);
  }
  cpSync(sourceDir, destDir, { recursive: true });
}
