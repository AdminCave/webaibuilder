/**
 * Headless tests of the secrets service (Node, without Electron). @napi-rs/keyring
 * runs under Node — the self-test/roundtrip path only runs if this system has a
 * keychain; the fallback paths are deterministic via injected entry factories,
 * independent of the CI environment.
 *
 * BOTH paths are tested:
 *  - real OS keychain (if present; otherwise the service degrades)
 *  - forced/detected in-memory fallback
 */

import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SecretsService,
  secretAccount,
  type KeyringEntry,
  type KeyringEntryFactory,
} from './secrets';

/** Keychain fake: behaves like a present, working backend. */
function fakeKeyring(): { factory: KeyringEntryFactory; store: Map<string, string> } {
  const store = new Map<string, string>();
  const factory: KeyringEntryFactory = (_service, account): KeyringEntry => ({
    setPassword: (password) => {
      store.set(account, password);
    },
    getPassword: () => store.get(account) ?? null,
    deleteCredential: () => store.delete(account),
  });
  return { factory, store };
}

/** Fake backend that throws on every operation — like a missing Secret Service. */
const throwingFactory: KeyringEntryFactory = (): KeyringEntry => ({
  setPassword: () => {
    throw new Error('no Secret Service available');
  },
  getPassword: () => {
    throw new Error('no Secret Service available');
  },
  deleteCredential: () => {
    throw new Error('no Secret Service available');
  },
});

describe('secretAccount — key naming scheme', () => {
  it('encodes kind and id as `<kind>:<id>`', () => {
    expect(secretAccount('apikey', 'anthropic')).toBe('apikey:anthropic');
    expect(secretAccount('deploy', 'ziel-ionos')).toBe('deploy:ziel-ionos');
  });
});

describe('SecretsService — in-memory fallback (forced)', () => {
  it('reports keychainAvailable=false with a reason', () => {
    const svc = new SecretsService({ forceFallback: true });
    const status = svc.keychainAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });

  it('set → get → delete roundtrip (generic)', () => {
    const svc = new SecretsService({ forceFallback: true });
    expect(svc.getSecret('deploy', 'z1')).toBeNull();
    svc.setSecret('deploy', 'z1', 'geheim');
    expect(svc.getSecret('deploy', 'z1')).toBe('geheim');
    expect(svc.hasSecret('deploy', 'z1')).toBe(true);
    expect(svc.deleteSecret('deploy', 'z1')).toBe(true);
    expect(svc.getSecret('deploy', 'z1')).toBeNull();
    expect(svc.hasSecret('deploy', 'z1')).toBe(false);
  });

  it('an empty value deletes instead of storing', () => {
    const svc = new SecretsService({ forceFallback: true });
    svc.setSecret('apikey', 'openai', 'x');
    svc.setSecret('apikey', 'openai', '');
    expect(svc.hasSecret('apikey', 'openai')).toBe(false);
  });

  it('hasApiKey reflects the state', () => {
    const svc = new SecretsService({ forceFallback: true });
    expect(svc.hasApiKey('byok', 'openai')).toBe(false);
    svc.setApiKey('byok', 'openai', 'sk-openai');
    expect(svc.hasApiKey('byok', 'openai')).toBe(true);
    expect(svc.getApiKey('byok', 'openai')).toBe('sk-openai');
    svc.deleteApiKey('byok', 'openai');
    expect(svc.hasApiKey('byok', 'openai')).toBe(false);
  });

  it('shares the Anthropic key between claude-sdk and byok/anthropic', () => {
    const svc = new SecretsService({ forceFallback: true });
    // claude-sdk ignores the provider parameter → always anthropic.
    svc.setApiKey('claude-sdk', 'openai', 'sk-ant');
    expect(svc.getApiKey('byok', 'anthropic')).toBe('sk-ant');
    expect(svc.hasApiKey('claude-sdk', 'anthropic')).toBe(true);
    // Other providers remain untouched.
    expect(svc.getApiKey('byok', 'openai')).toBeNull();
  });
});

describe('SecretsService — fallback activates when the keyring throws', () => {
  it('detects the failure during the self-test and then works in memory', () => {
    const svc = new SecretsService({ entryFactory: throwingFactory });
    const status = svc.keychainAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toContain('Secret Service');

    // Despite the throwing backend no crash — ops run through memory.
    svc.setApiKey('byok', 'openai', 'sk-mem');
    expect(svc.getApiKey('byok', 'openai')).toBe('sk-mem');
    expect(svc.deleteApiKey('byok', 'openai')).toBe(true);
    expect(svc.getApiKey('byok', 'openai')).toBeNull();
  });
});

describe('SecretsService — working backend (fake keyring)', () => {
  it('reports keychainAvailable=true and leaves no self-test residue', () => {
    const { factory, store } = fakeKeyring();
    const svc = new SecretsService({ entryFactory: factory });
    expect(svc.keychainAvailable().available).toBe(true);
    // The self-test deleted its sentinel again.
    expect(store.size).toBe(0);
  });

  it('writes/reads/deletes through the backend (not through memory)', () => {
    const { factory, store } = fakeKeyring();
    const svc = new SecretsService({ entryFactory: factory });
    svc.setApiKey('byok', 'openai', 'sk-backend');
    expect(store.get('apikey:openai')).toBe('sk-backend');
    expect(svc.getApiKey('byok', 'openai')).toBe('sk-backend');
    expect(svc.deleteApiKey('byok', 'openai')).toBe(true);
    expect(store.has('apikey:openai')).toBe(false);
  });
});

/*
 * Real OS keychain: only run if present. Uses an isolated service name + random
 * id so that no real user credentials are touched. The roundtrip works
 * deterministically — even without a keychain, because the service then cleanly
 * degrades to memory.
 */
describe('SecretsService — real OS keychain (if present)', () => {
  const service = `WebAIBuilder-Test-${randomUUID()}`;
  const id = randomUUID();
  let svc: SecretsService;

  afterEach(() => {
    // Clean up in case the real keychain was used.
    try {
      svc?.deleteSecret('deploy', id);
    } catch {
      /* ignore */
    }
  });

  it('set → get → delete roundtrip through the active path', () => {
    svc = new SecretsService({ service });
    const status = svc.keychainAvailable();
    // Make visible which path the CI actually exercised.
    console.info(
      `[secrets.test] Real keychain available: ${status.available}` +
        (status.reason !== undefined ? ` (reason: ${status.reason})` : ''),
    );

    expect(svc.getSecret('deploy', id)).toBeNull();
    svc.setSecret('deploy', id, 'roundtrip-secret');
    expect(svc.getSecret('deploy', id)).toBe('roundtrip-secret');
    expect(svc.deleteSecret('deploy', id)).toBe(true);
    expect(svc.getSecret('deploy', id)).toBeNull();
    // Status is stable across the run.
    expect(typeof status.available).toBe('boolean');
  });
});
