/**
 * Headless-Tests des Einstellungs-Stores (Node, ohne Electron). Der Secrets-
 * Dienst wird injiziert (erzwungener In-Memory-Fallback bzw. Fake-Backend),
 * damit die Tests deterministisch laufen und keine echten Credentials berühren.
 *
 * Kernzusicherung (PLAN §4): der API-Key landet NIE in der persistierten JSON.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SecretsService, type KeyringEntry, type KeyringEntryFactory } from './secrets';
import { AgentSettingsStore } from './settingsStore';

function fakeKeyringFactory(): KeyringEntryFactory {
  const store = new Map<string, string>();
  return (_service, account): KeyringEntry => ({
    setPassword: (password) => {
      store.set(account, password);
    },
    getPassword: () => store.get(account) ?? null,
    deleteCredential: () => store.delete(account),
  });
}

let tmp: string;
let filePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-settings-'));
  filePath = join(tmp, 'agent-settings.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('AgentSettingsStore — Persistenz ohne Secret', () => {
  it('schreibt nur secret-freie Felder auf die Platte (kein API-Key)', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    store.set({ backendId: 'byok', provider: 'openai', model: 'gpt-x', apiKey: 'sk-geheim-123' });

    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['backendId', 'model', 'provider']);
    expect(parsed).not.toHaveProperty('apiKey');
    expect(parsed).not.toHaveProperty('hasApiKey');
    // Der Key-Klartext taucht nirgends in der Datei auf.
    expect(raw).not.toContain('sk-geheim-123');
  });
});

describe('AgentSettingsStore — abgeleitete Flags', () => {
  it('hasApiKey/currentApiKey spiegeln den Schlüsselbund-Zustand', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();

    store.set({ backendId: 'byok', provider: 'openai', apiKey: 'sk-openai' });
    expect(store.get().hasApiKey).toBe(true);
    expect(store.currentApiKey()).toBe('sk-openai');

    // apiKey: null löscht.
    store.set({ apiKey: null });
    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();
  });

  it('keychainAvailable=false beim Fallback, true beim funktionierenden Backend', () => {
    const fallback = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    expect(fallback.get().keychainAvailable).toBe(false);

    const withBackend = new AgentSettingsStore(
      join(tmp, 'other.json'),
      new SecretsService({ entryFactory: fakeKeyringFactory() }),
    );
    expect(withBackend.get().keychainAvailable).toBe(true);
  });

  it('Keys sind pro Provider getrennt', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    store.set({ backendId: 'byok', provider: 'openai', apiKey: 'sk-openai' });
    // Provider wechseln, ohne Key → hasApiKey false für den neuen Provider.
    store.set({ provider: 'anthropic' });
    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();
    // Zurück zu openai → Key ist noch da.
    store.set({ provider: 'openai' });
    expect(store.get().hasApiKey).toBe(true);
    expect(store.currentApiKey()).toBe('sk-openai');
  });
});

describe('AgentSettingsStore — Wiedereröffnen', () => {
  it('secret-freie Einstellungen überleben einen Neustart; Key bleibt im Schlüsselbund', () => {
    // Gemeinsamer Secrets-Dienst = simuliert einen persistenten Schlüsselbund
    // über zwei "App-Läufe" hinweg.
    const secrets = new SecretsService({ entryFactory: fakeKeyringFactory() });

    const first = new AgentSettingsStore(filePath, secrets);
    first.set({ backendId: 'claude-sdk', model: 'claude-opus-4-8', apiKey: 'sk-ant' });

    const second = new AgentSettingsStore(filePath, secrets);
    const view = second.get();
    expect(view.backendId).toBe('claude-sdk');
    expect(view.model).toBe('claude-opus-4-8');
    expect(view.hasApiKey).toBe(true);
    expect(second.currentApiKey()).toBe('sk-ant');
  });
});
