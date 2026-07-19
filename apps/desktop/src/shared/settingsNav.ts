/**
 * Navigation des Einstellungs-Dialogs (Sektionen + Deep-Links). Rein und
 * umgebungsneutral — von App/Settings-Komponenten genutzt und headless testbar.
 *
 * Deep-Links erlauben es z. B. dem Chat-Empty-State, die Einstellungen direkt
 * auf der richtigen Backend-Karte zu öffnen (`{ section: 'backends',
 * backendId: 'byok' }`).
 */

import type { BackendId } from '@webaibuilder/core';

export type SettingsSection = 'backends' | 'appearance' | 'help';

/** Ziel beim Öffnen der Einstellungen. */
export interface SettingsRoute {
  section: SettingsSection;
  /** Optional: diese Backend-Karte aufgeklappt anzeigen/hinscrollen. */
  backendId?: BackendId;
}

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'backends', label: 'KI & Backends' },
  { id: 'appearance', label: 'Darstellung' },
  { id: 'help', label: 'Hilfe & Logs' },
];

export const DEFAULT_SETTINGS_ROUTE: SettingsRoute = { section: 'backends' };

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((s) => s.id));

/** Liest einen unbekannten Wert defensiv als Route ein (Default: backends). */
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
