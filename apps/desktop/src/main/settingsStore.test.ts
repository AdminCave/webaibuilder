/**
 * Headless tests of the settings store (Node, without Electron). The secrets
 * service is injected (forced in-memory fallback resp. fake backend) so the
 * tests run deterministically and never touch real credentials.
 *
 * Core guarantee (PLAN §4): the API key NEVER ends up in the persisted JSON.
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

describe('AgentSettingsStore — persistence without a secret', () => {
  it('writes only secret-free fields to disk (no API key)', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    store.set({ backendId: 'byok', provider: 'openai', model: 'gpt-x', apiKey: 'sk-geheim-123' });

    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['backendId', 'model', 'provider']);
    expect(parsed).not.toHaveProperty('apiKey');
    expect(parsed).not.toHaveProperty('hasApiKey');
    // The key plaintext appears nowhere in the file.
    expect(raw).not.toContain('sk-geheim-123');
  });
});

describe('AgentSettingsStore — derived flags', () => {
  it('hasApiKey/currentApiKey reflect the keychain state', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();

    store.set({ backendId: 'byok', provider: 'openai', apiKey: 'sk-openai' });
    expect(store.get().hasApiKey).toBe(true);
    expect(store.currentApiKey()).toBe('sk-openai');

    // apiKey: null deletes.
    store.set({ apiKey: null });
    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();
  });

  it('keychainAvailable=false with the fallback, true with a working backend', () => {
    const fallback = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    expect(fallback.get().keychainAvailable).toBe(false);

    const withBackend = new AgentSettingsStore(
      join(tmp, 'other.json'),
      new SecretsService({ entryFactory: fakeKeyringFactory() }),
    );
    expect(withBackend.get().keychainAvailable).toBe(true);
  });

  it('keys are separated per provider', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    store.set({ backendId: 'byok', provider: 'openai', apiKey: 'sk-openai' });
    // Switch provider, no key → hasApiKey false for the new provider.
    store.set({ provider: 'anthropic' });
    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();
    // Back to openai → the key is still there.
    store.set({ provider: 'openai' });
    expect(store.get().hasApiKey).toBe(true);
    expect(store.currentApiKey()).toBe('sk-openai');
  });
});

describe('AgentSettingsStore — env key fallback', () => {
  it('hasApiKey/currentApiKey fall back to the environment variable', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets, { ANTHROPIC_API_KEY: 'sk-env' });

    // Default byok/anthropic without a keychain key → the env key unlocks it.
    const view = store.get();
    expect(view.hasApiKey).toBe(true);
    expect(view.apiKeySource).toBe('env');
    expect(store.currentApiKey()).toBe('sk-env');
  });

  it('the keychain wins over the environment', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets, { ANTHROPIC_API_KEY: 'sk-env' });

    store.set({ apiKey: 'sk-keychain' });
    expect(store.get().apiKeySource).toBe('keychain');
    expect(store.currentApiKey()).toBe('sk-keychain');
  });

  it('counts per EFFECTIVE provider (claude-sdk → anthropic, byok/openai → OPENAI_API_KEY)', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets, { OPENAI_API_KEY: 'sk-oai' });

    // byok/anthropic: no ANTHROPIC_API_KEY in the environment → locked.
    expect(store.get().hasApiKey).toBe(false);
    // byok/openai: OPENAI_API_KEY takes effect.
    store.set({ provider: 'openai' });
    expect(store.get().hasApiKey).toBe(true);
    expect(store.currentApiKey()).toBe('sk-oai');
    // claude-sdk always speaks Anthropic — the OpenAI key does not count there.
    store.set({ backendId: 'claude-sdk' });
    expect(store.get().hasApiKey).toBe(false);
  });

  it('subscription backends stay unaffected by the env key; empty values do not count', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const subscription = new AgentSettingsStore(filePath, secrets, {
      ANTHROPIC_API_KEY: 'sk-env',
    });
    subscription.set({ backendId: 'codex' });
    expect(subscription.get().hasApiKey).toBe(false);
    expect(subscription.currentApiKey()).toBeUndefined();

    const blank = new AgentSettingsStore(join(tmp, 'blank.json'), secrets, {
      ANTHROPIC_API_KEY: '   ',
    });
    expect(blank.get().hasApiKey).toBe(false);
    expect(blank.get().apiKeySource).toBeUndefined();
    expect(blank.currentApiKey()).toBeUndefined();
  });
});

describe('AgentSettingsStore — subscription/CLI backends need no key', () => {
  it('hasApiKey is false and currentApiKey undefined even though an Anthropic key is present', () => {
    const secrets = new SecretsService({ forceFallback: true });
    const store = new AgentSettingsStore(filePath, secrets);

    // Store an Anthropic key (byok) — it must NOT gate a subscription backend.
    store.set({ backendId: 'byok', provider: 'anthropic', apiKey: 'sk-ant' });
    expect(store.get().hasApiKey).toBe(true);

    // Switch to a subscription/CLI backend: no app-managed key (PLAN §3).
    store.set({ backendId: 'claude-cli' });
    expect(store.get().hasApiKey).toBe(false);
    expect(store.currentApiKey()).toBeUndefined();
    // Model is empty for CLI backends (the CLI determines it itself).
    expect(store.currentModel()).toBe('');
    expect(store.currentBackendId()).toBe('claude-cli');
  });
});

/* ------------------------------------------------------------------ */
/* Main gate: subscription backend only active when ready (injected fakes) */
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

describe('applySettingsUpdate — authoritative activation check', () => {
  it('persists a ready subscription backend as the active backend', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([raw('codex', { installed: true, loggedIn: true })]);

    const next = await applySettingsUpdate(store, src, { backendId: 'codex' });
    expect(next.backendId).toBe('codex');
    expect(next.hasApiKey).toBe(false);
    expect(store.currentBackendId()).toBe('codex');
    expect(store.currentApiKey()).toBeUndefined();
  });

  it('rejects a not-installed subscription backend and does NOT persist', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([raw('codex', { installed: false })]);

    await expect(applySettingsUpdate(store, src, { backendId: 'codex' })).rejects.toThrow(
      /not installed/,
    );
    expect(store.currentBackendId()).toBe('byok'); // unchanged (default)
  });

  it('rejects a not-signed-in subscription backend', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([raw('gemini-cli', { installed: true, loggedIn: false })]);

    await expect(applySettingsUpdate(store, src, { backendId: 'gemini-cli' })).rejects.toThrow(
      /not signed in/,
    );
    expect(store.currentBackendId()).toBe('byok');
  });

  it('rejects a kill-switch-disabled subscription backend with the reason', async () => {
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

  it('claude-cli: activatable only after acknowledgment', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const notAcked = readiness([raw('claude-cli', { installed: true, loggedIn: true })]);
    await expect(applySettingsUpdate(store, notAcked, { backendId: 'claude-cli' })).rejects.toThrow(
      /Acknowledge the notice/,
    );
    expect(store.currentBackendId()).toBe('byok');

    const acked = readiness([raw('claude-cli', { installed: true, loggedIn: true })], ['claude-cli']);
    const next = await applySettingsUpdate(store, acked, { backendId: 'claude-cli' });
    expect(next.backendId).toBe('claude-cli');
    expect(store.currentBackendId()).toBe('claude-cli');
  });

  it('API-key backends pass through unhindered (no detection needed)', async () => {
    const store = new AgentSettingsStore(filePath, new SecretsService({ forceFallback: true }));
    const src = readiness([]);
    const spy = vi.spyOn(src, 'availability');

    const next = await applySettingsUpdate(store, src, {
      backendId: 'claude-sdk',
      apiKey: 'sk-ant',
    });
    expect(next.backendId).toBe('claude-sdk');
    expect(next.hasApiKey).toBe(true);
    // For API-key backends the subscription detection is not consulted at all.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AgentSettingsStore — reopening', () => {
  it('secret-free settings survive a restart; the key stays in the keychain', () => {
    // Shared secrets service = simulates a persistent keychain
    // across two "app runs".
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
