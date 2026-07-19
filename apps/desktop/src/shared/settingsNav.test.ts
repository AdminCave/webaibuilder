/** Headless tests of the settings navigation (sections + deep-link coercion). */

import { describe, expect, it } from 'vitest';

import {
  coerceSettingsRoute,
  DEFAULT_SETTINGS_ROUTE,
  SETTINGS_SECTIONS,
} from './settingsNav';

describe('SETTINGS_SECTIONS', () => {
  it('contains the three categories in display order', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['backends', 'appearance', 'help']);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
    }
  });
});

describe('coerceSettingsRoute', () => {
  it('reads a valid route including a deep-link backend', () => {
    expect(coerceSettingsRoute({ section: 'help' })).toEqual({ section: 'help' });
    expect(coerceSettingsRoute({ section: 'backends', backendId: 'byok' })).toEqual({
      section: 'backends',
      backendId: 'byok',
    });
  });

  it('falls back to the default section for unknown input', () => {
    expect(coerceSettingsRoute(null)).toEqual(DEFAULT_SETTINGS_ROUTE);
    expect(coerceSettingsRoute('quatsch')).toEqual(DEFAULT_SETTINGS_ROUTE);
    expect(coerceSettingsRoute({ section: 'gibts-nicht' })).toEqual(DEFAULT_SETTINGS_ROUTE);
  });
});
