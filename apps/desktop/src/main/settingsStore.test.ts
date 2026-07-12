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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackendId } from '@webaibuilder/core';

import {
  buildAvailabilityViews,
  coerceKillSwitchConfig,
  resolveKillSwitch,
  type BackendPickerState,
  type KillSwitchConfig,
  type RawBackendAvailability,
} from '../shared/backends';
import { SecretsService, type KeyringEntry, type KeyringEntryFactory } from './secrets';
import {
  AgentSettingsStore,
  applySettingsUpdate,
  type SubscriptionReadinessSource,
} from './settingsStore';

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

describe('AgentSettingsStore — Abo-/CLI-Backends brauchen keinen Key', () => {
  it('hasApiKey ist false und currentApiKey undefined, obwohl ein Anthropic-Key vorliegt', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    // Anthropic-Key hinterlegen (byok) — er darf ein Abo-Backend NICHT gaten.
    store.set({ backendId: 'byok', provider: 'anthropic', apiKey: 'sk-ant' });
    expect(store.get().hasApiKey).toBe(true);

    // Auf ein Abo-/CLI-Backend wechseln: kein app-verwalteter Key (PLAN §3).
    store.set({ backendId: 'claude-cli' });
    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();
    // Modell ist für CLI-Backends leer (die CLI bestimmt es selbst).
    expect(store.currentModel()).toBe('');
    expect(store.currentBackendId()).toBe('claude-cli');
  });
});

/* ------------------------------------------------------------------ */
/* Main-Gate: Abo-Backend nur aktiv, wenn bereit (injizierte Fakes)     */
/* ------------------------------------------------------------------ */

function raw(id: BackendId, over: Partial<RawBackendAvailability> = {}): RawBackendAvailability {
  return { backendId: id, installed: true, loggedIn: true, ...over };
}

function readiness(
  raws: RawBackendAvailability[],
  acked: BackendId[] = [],
  remote: KillSwitchConfig | null = null,
): SubscriptionReadinessSource {
  const state: BackendPickerState = {
    backends: buildAvailabilityViews(raws, resolveKillSwitch(remote), new Set(acked)),
    acknowledged: [...acked],
  };
  return { availability: () => Promise.resolve(state) };
}

describe('applySettingsUpdate — autoritative Aktivierungsprüfung', () => {
  it('persistiert ein bereites Abo-Backend als aktives Backend', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([raw('codex', { installed: true, loggedIn: true })]);

    const next = await applySettingsUpdate(store, src, { backendId: 'codex' });
    expect(next.backendId).toBe('codex');
    expect(next.hasApiKey).toBe(false);
    expect(store.currentBackendId()).toBe('codex');
    expect(store.currentApiKey()).toBeUndefined();
  });

  it('lehnt ein nicht installiertes Abo-Backend ab und persistiert NICHT', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([raw('codex', { installed: false })]);

    await expect(applySettingsUpdate(store, src, { backendId: 'codex' })).rejects.toThrow(
      /nicht installiert/,
    );
    expect(store.currentBackendId()).toBe('byok'); // unverändert (Default)
  });

  it('lehnt ein nicht eingeloggtes Abo-Backend ab', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([raw('gemini-cli', { installed: true, loggedIn: false })]);

    await expect(applySettingsUpdate(store, src, { backendId: 'gemini-cli' })).rejects.toThrow(
      /nicht eingeloggt/,
    );
    expect(store.currentBackendId()).toBe('byok');
  });

  it('lehnt ein per Kill-Switch deaktiviertes Abo-Backend mit dem Grund ab', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const remote = coerceKillSwitchConfig({
      backends: { 'grok-cli': { enabled: false, reason: 'xAI-Pfad pausiert.' } },
    });
    const src = readiness([raw('grok-cli', { installed: true, loggedIn: true })], [], resolveKillSwitch(remote));

    await expect(applySettingsUpdate(store, src, { backendId: 'grok-cli' })).rejects.toThrow(
      'xAI-Pfad pausiert.',
    );
    expect(store.currentBackendId()).toBe('byok');
  });

  it('claude-cli: erst nach Bestätigung aktivierbar', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const notAcked = readiness([raw('claude-cli', { installed: true, loggedIn: true })]);
    await expect(applySettingsUpdate(store, notAcked, { backendId: 'claude-cli' })).rejects.toThrow(
      /Bestätige zuerst/,
    );
    expect(store.currentBackendId()).toBe('byok');

    const acked = readiness([raw('claude-cli', { installed: true, loggedIn: true })], ['claude-cli']);
    const next = await applySettingsUpdate(store, acked, { backendId: 'claude-cli' });
    expect(next.backendId).toBe('claude-cli');
    expect(store.currentBackendId()).toBe('claude-cli');
  });

  it('API-Key-Backends laufen ungehindert durch (keine Erkennung nötig)', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([]);
    const spy = vi.spyOn(src, 'availability');

    const next = await applySettingsUpdate(store, src, {
      backendId: 'claude-sdk',
      apiKey: 'sk-ant',
    });
    expect(next.backendId).toBe('claude-sdk');
    expect(next.hasApiKey).toBe(true);
    // Für API-Key-Backends wird die Abo-Erkennung gar nicht konsultiert.
    expect(spy).not.toHaveBeenCalled();
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
