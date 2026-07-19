/**
 * Navigation of the settings dialog (sections + deep links). Pure and
 * environment-neutral — used by App/Settings components and headless-testable.
 *
 * Deep links let, for example, the chat empty-state open Settings directly on the
 * correct backend card (`{ section: 'backends', backendId: 'byok' }`).
 */

import type { BackendId } from '@webaibuilder/core';

export type SettingsSection = 'backends' | 'appearance' | 'help';

/** Target when opening Settings. */
export interface SettingsRoute {
  section: SettingsSection;
  /** Optional: show this backend card expanded / scroll to it. */
  backendId?: BackendId;
}

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'backends', label: 'AI & Backends' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'help', label: 'Help & Logs' },
];

export const DEFAULT_SETTINGS_ROUTE: SettingsRoute = { section: 'backends' };

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((s) => s.id));

/** Defensively parses an unknown value as a route (default: backends). */
export function coerceSettingsRoute(value: unknown): SettingsRoute {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS_ROUTE };
  const obj = value as Record<string, unknown>;
  const section =
    typeof obj['section'] === 'string' && SECTION_IDS.has(obj['section'])
      ? (obj['section'] as SettingsSection)
      : DEFAULT_SETTINGS_ROUTE.section;
  const backendId = typeof obj['backendId'] === 'string' ? (obj['backendId'] as BackendId) : undefined;
  return { section, ...(backendId !== undefined ? { backendId } : {}) };
}
