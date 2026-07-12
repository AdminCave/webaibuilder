import { describe, expect, it } from 'vitest';

import {
  coerceAgentSettings,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_CLAUDE_MODEL,
  effectiveModel,
  mergeAgentSettings,
} from './settings';

describe('mergeAgentSettings', () => {
  it('übernimmt gültige Felder und trimmt das Modell', () => {
    const next = mergeAgentSettings(DEFAULT_AGENT_SETTINGS, {
      backendId: 'claude-sdk',
      model: '  claude-opus-4-8  ',
    });
    expect(next).toEqual({ backendId: 'claude-sdk', provider: 'anthropic', model: 'claude-opus-4-8' });
  });

  it('fällt bei ungültigen Werten auf den Bestand zurück', () => {
    const next = mergeAgentSettings(DEFAULT_AGENT_SETTINGS, {
      backendId: 'gibts-nicht' as never,
      provider: 'quatsch' as never,
    });
    expect(next.backendId).toBe(DEFAULT_AGENT_SETTINGS.backendId);
    expect(next.provider).toBe(DEFAULT_AGENT_SETTINGS.provider);
  });

  it('ignoriert apiKey (kein secret-freies Feld)', () => {
    const next = mergeAgentSettings(DEFAULT_AGENT_SETTINGS, { apiKey: 'geheim' });
    expect(next).not.toHaveProperty('apiKey');
  });

  it('akzeptiert Abo-/CLI-Backends als aktives Backend (M4)', () => {
    for (const id of ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'] as const) {
      expect(mergeAgentSettings(DEFAULT_AGENT_SETTINGS, { backendId: id }).backendId).toBe(id);
    }
  });
});

describe('coerceAgentSettings', () => {
  it('liefert Defaults für Nicht-Objekte', () => {
    expect(coerceAgentSettings(undefined)).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(coerceAgentSettings('kaputt')).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it('liest bekannte Felder ein', () => {
    expect(coerceAgentSettings({ backendId: 'byok', provider: 'openai', model: 'x' })).toEqual({
      backendId: 'byok',
      provider: 'openai',
      model: 'x',
    });
  });

  it('liest ein Abo-/CLI-Backend als aktives Backend ein (M4)', () => {
    expect(coerceAgentSettings({ backendId: 'claude-cli', provider: 'anthropic', model: '' })).toEqual(
      { backendId: 'claude-cli', provider: 'anthropic', model: '' },
    );
  });
});

describe('effectiveModel', () => {
  it('nutzt das Override-Modell, wenn gesetzt', () => {
    expect(effectiveModel({ backendId: 'byok', provider: 'openai', model: 'gpt-x' })).toBe('gpt-x');
  });

  it('nimmt für claude-sdk das Claude-Standardmodell', () => {
    expect(effectiveModel({ backendId: 'claude-sdk', provider: 'anthropic', model: '' })).toBe(
      DEFAULT_CLAUDE_MODEL,
    );
  });

  it('nimmt für byok/anthropic das Claude-Standardmodell', () => {
    expect(effectiveModel({ backendId: 'byok', provider: 'anthropic', model: '' })).toBe(
      DEFAULT_CLAUDE_MODEL,
    );
  });

  it('lässt das Modell für andere byok-Provider leer (Backend-Default)', () => {
    expect(effectiveModel({ backendId: 'byok', provider: 'openai', model: '' })).toBe('');
  });

  it('liefert für Abo-/CLI-Backends immer ein leeres Modell (die CLI bestimmt es)', () => {
    // Auch ein gesetzter Override wird ignoriert — CLI-Backends haben kein Modell-Konzept.
    expect(effectiveModel({ backendId: 'claude-cli', provider: 'anthropic', model: 'egal' })).toBe('');
    expect(effectiveModel({ backendId: 'codex', provider: 'openai', model: '' })).toBe('');
  });
});
