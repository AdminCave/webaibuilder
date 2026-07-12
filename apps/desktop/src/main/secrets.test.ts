/**
 * Headless-Tests des Secrets-Dienstes (Node, ohne Electron). @napi-rs/keyring
 * läuft unter Node — der Selbsttest-/Roundtrip-Pfad wird nur ausgeführt, wenn
 * dieses System einen Schlüsselbund hat; die Fallback-Pfade sind über injizierte
 * Eintrags-Fabriken deterministisch, unabhängig von der CI-Umgebung.
 *
 * Getestet werden BEIDE Pfade:
 *  - echter OS-Schlüsselbund (falls vorhanden; sonst degradiert der Dienst)
 *  - erzwungener/erkannter In-Memory-Fallback
 */

import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SecretsService,
  secretAccount,
  type KeyringEntry,
  type KeyringEntryFactory,
} from './secrets';

/** Fake-Schlüsselbund: verhält sich wie ein vorhandenes, funktionierendes Backend. */
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

/** Fake-Backend, das jede Operation wirft — wie ein fehlender Secret Service. */
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

describe('secretAccount — Key-Naming-Schema', () => {
  it('kodiert Art und Id als `<kind>:<id>`', () => {
    expect(secretAccount('apikey', 'anthropic')).toBe('apikey:anthropic');
    expect(secretAccount('deploy', 'ziel-ionos')).toBe('deploy:ziel-ionos');
  });
});

describe('SecretsService — In-Memory-Fallback (erzwungen)', () => {
  it('meldet keychainAvailable=false mit Grund', () => {
    const svc = new SecretsService({ forceFallback: true });
    const status = svc.keychainAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });

  it('set → get → delete Roundtrip (generisch)', () => {
    const svc = new SecretsService({ forceFallback: true });
    expect(svc.getSecret('deploy', 'z1')).toBeNull();
    svc.setSecret('deploy', 'z1', 'geheim');
    expect(svc.getSecret('deploy', 'z1')).toBe('geheim');
    expect(svc.hasSecret('deploy', 'z1')).toBe(true);
    expect(svc.deleteSecret('deploy', 'z1')).toBe(true);
    expect(svc.getSecret('deploy', 'z1')).toBeNull();
    expect(svc.hasSecret('deploy', 'z1')).toBe(false);
  });

  it('leerer Wert löscht statt zu speichern', () => {
    const svc = new SecretsService({ forceFallback: true });
    svc.setSecret('apikey', 'openai', 'x');
    svc.setSecret('apikey', 'openai', '');
    expect(svc.hasSecret('apikey', 'openai')).toBe(false);
  });

  it('hasApiKey spiegelt den Zustand', () => {
    const svc = new SecretsService({ forceFallback: true });
    expect(svc.hasApiKey('byok', 'openai')).toBe(false);
    svc.setApiKey('byok', 'openai', 'sk-openai');
    expect(svc.hasApiKey('byok', 'openai')).toBe(true);
    expect(svc.getApiKey('byok', 'openai')).toBe('sk-openai');
    svc.deleteApiKey('byok', 'openai');
    expect(svc.hasApiKey('byok', 'openai')).toBe(false);
  });

  it('teilt den Anthropic-Key zwischen claude-sdk und byok/anthropic', () => {
    const svc = new SecretsService({ forceFallback: true });
    // claude-sdk ignoriert den Provider-Parameter → immer anthropic.
    svc.setApiKey('claude-sdk', 'openai', 'sk-ant');
    expect(svc.getApiKey('byok', 'anthropic')).toBe('sk-ant');
    expect(svc.hasApiKey('claude-sdk', 'anthropic')).toBe(true);
    // Andere Provider bleiben unberührt.
    expect(svc.getApiKey('byok', 'openai')).toBeNull();
  });
});

describe('SecretsService — Fallback aktiviert sich, wenn der Keyring wirft', () => {
  it('erkennt den Ausfall beim Selbsttest und arbeitet danach im Speicher', () => {
    const svc = new SecretsService({ entryFactory: throwingFactory });
    const status = svc.keychainAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toContain('Secret Service');

    // Trotz geworfenem Backend kein Crash — Ops laufen über den Speicher.
    svc.setApiKey('byok', 'openai', 'sk-mem');
    expect(svc.getApiKey('byok', 'openai')).toBe('sk-mem');
    expect(svc.deleteApiKey('byok', 'openai')).toBe(true);
    expect(svc.getApiKey('byok', 'openai')).toBeNull();
  });
});

describe('SecretsService — funktionierendes Backend (Fake-Keyring)', () => {
  it('meldet keychainAvailable=true und hinterlässt keinen Selbsttest-Rest', () => {
    const { factory, store } = fakeKeyring();
    const svc = new SecretsService({ entryFactory: factory });
    expect(svc.keychainAvailable().available).toBe(true);
    // Der Selbsttest hat seinen Sentinel wieder gelöscht.
    expect(store.size).toBe(0);
  });

  it('schreibt/liest/löscht durch das Backend (nicht durch den Speicher)', () => {
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
 * Echter OS-Schlüsselbund: nur ausgeführt, wenn vorhanden. Nutzt einen
 * isolierten Dienstnamen + zufällige Id, damit keine echten Nutzer-Credentials
 * berührt werden. Der Roundtrip funktioniert deterministisch — auch ohne
 * Schlüsselbund, weil der Dienst dann sauber in den Speicher degradiert.
 */
describe('SecretsService — echter OS-Schlüsselbund (falls vorhanden)', () => {
  const service = `WebAIBuilder-Test-${randomUUID()}`;
  const id = randomUUID();
  let svc: SecretsService;

  afterEach(() => {
    // Aufräumen, falls der echte Schlüsselbund genutzt wurde.
    try {
      svc?.deleteSecret('deploy', id);
    } catch {
      /* egal */
    }
  });

  it('set → get → delete Roundtrip über den aktiven Pfad', () => {
    svc = new SecretsService({ service });
    const status = svc.keychainAvailable();
    // Sichtbar machen, welchen Pfad die CI tatsächlich ausgeübt hat.
    console.info(
      `[secrets.test] Realer Schlüsselbund verfügbar: ${status.available}` +
        (status.reason !== undefined ? ` (Grund: ${status.reason})` : ''),
    );

    expect(svc.getSecret('deploy', id)).toBeNull();
    svc.setSecret('deploy', id, 'roundtrip-secret');
    expect(svc.getSecret('deploy', id)).toBe('roundtrip-secret');
    expect(svc.deleteSecret('deploy', id)).toBe(true);
    expect(svc.getSecret('deploy', id)).toBeNull();
    // Status ist über den Lauf stabil.
    expect(typeof status.available).toBe('boolean');
  });
});
