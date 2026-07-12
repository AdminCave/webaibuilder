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
});
