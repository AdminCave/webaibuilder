/** Headless-Tests der Settings-Navigation (Sektionen + Deep-Link-Coercion). */

import { describe, expect, it } from 'vitest';

import {
  coerceSettingsRoute,
  DEFAULT_SETTINGS_ROUTE,
  SETTINGS_SECTIONS,
} from './settingsNav';

describe('SETTINGS_SECTIONS', () => {
  it('enthält die drei Kategorien in Anzeigereihenfolge', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['backends', 'appearance', 'help']);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
    }
  });
});

describe('coerceSettingsRoute', () => {
  it('liest eine gültige Route inkl. Deep-Link-Backend', () => {
    expect(coerceSettingsRoute({ section: 'help' })).toEqual({ section: 'help' });
    expect(coerceSettingsRoute({ section: 'backends', backendId: 'byok' })).toEqual({
      section: 'backends',
      backendId: 'byok',
    });
  });

  it('fällt bei Unbekanntem auf die Default-Sektion zurück', () => {
    expect(coerceSettingsRoute(null)).toEqual(DEFAULT_SETTINGS_ROUTE);
    expect(coerceSettingsRoute('quatsch')).toEqual(DEFAULT_SETTINGS_ROUTE);
    expect(coerceSettingsRoute({ section: 'gibts-nicht' })).toEqual(DEFAULT_SETTINGS_ROUTE);
  });
});
