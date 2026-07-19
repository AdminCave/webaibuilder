import { describe, expect, it } from 'vitest';

import {
  coerceAgentSettings,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_CLAUDE_MODEL,
  effectiveModel,
  mergeAgentSettings,
} from './settings';

describe('mergeAgentSettings', () => {
  it('adopts valid fields and trims the model', () => {
    const next = mergeAgentSettings(DEFAULT_AGENT_SETTINGS, {
      backendId: 'claude-sdk',
      model: '  claude-opus-4-8  ',
    });
    expect(next).toEqual({ backendId: 'claude-sdk', provider: 'anthropic', model: 'claude-opus-4-8' });
  });

  it('falls back to the existing values for invalid values', () => {
    const next = mergeAgentSettings(DEFAULT_AGENT_SETTINGS, {
      backendId: 'gibts-nicht' as never,
      provider: 'quatsch' as never,
    });
    expect(next.backendId).toBe(DEFAULT_AGENT_SETTINGS.backendId);
    expect(next.provider).toBe(DEFAULT_AGENT_SETTINGS.provider);
  });

  it('ignores apiKey (not a secret-free field)', () => {
    const next = mergeAgentSettings(DEFAULT_AGENT_SETTINGS, { apiKey: 'geheim' });
    expect(next).not.toHaveProperty('apiKey');
  });

  it('accepts subscription/CLI backends as the active backend (M4)', () => {
    for (const id of ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'] as const) {
      expect(mergeAgentSettings(DEFAULT_AGENT_SETTINGS, { backendId: id }).backendId).toBe(id);
    }
  });
});

describe('coerceAgentSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(coerceAgentSettings(undefined)).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(coerceAgentSettings('kaputt')).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it('reads known fields', () => {
    expect(coerceAgentSettings({ backendId: 'byok', provider: 'openai', model: 'x' })).toEqual({
      backendId: 'byok',
      provider: 'openai',
      model: 'x',
    });
  });

  it('reads a subscription/CLI backend as the active backend (M4)', () => {
    expect(coerceAgentSettings({ backendId: 'claude-cli', provider: 'anthropic', model: '' })).toEqual(
      { backendId: 'claude-cli', provider: 'anthropic', model: '' },
    );
  });
});

describe('effectiveModel', () => {
  it('uses the override model when set', () => {
    expect(effectiveModel({ backendId: 'byok', provider: 'openai', model: 'gpt-x' })).toBe('gpt-x');
  });

  it('uses the Claude default model for claude-sdk', () => {
    expect(effectiveModel({ backendId: 'claude-sdk', provider: 'anthropic', model: '' })).toBe(
      DEFAULT_CLAUDE_MODEL,
    );
  });

  it('uses the Claude default model for byok/anthropic', () => {
    expect(effectiveModel({ backendId: 'byok', provider: 'anthropic', model: '' })).toBe(
      DEFAULT_CLAUDE_MODEL,
    );
  });

  it('leaves the model empty for other byok providers (backend default)', () => {
    expect(effectiveModel({ backendId: 'byok', provider: 'openai', model: '' })).toBe('');
  });

  it('always returns an empty model for subscription/CLI backends (the CLI decides it)', () => {
    // A set override is also ignored — CLI backends have no model concept.
    expect(effectiveModel({ backendId: 'claude-cli', provider: 'anthropic', model: 'egal' })).toBe('');
    expect(effectiveModel({ backendId: 'codex', provider: 'openai', model: '' })).toBe('');
  });
});
