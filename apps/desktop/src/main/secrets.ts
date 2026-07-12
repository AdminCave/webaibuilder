/**
 * Secrets-Dienst des Main-Prozesses über den OS-Schlüsselbund
 * (`@napi-rs/keyring`, PLAN §4: kein bare `safeStorage` — Linux-Plaintext-Falle).
 *
 * Ein Eintrag ist ein `Entry(service, account)`. Der `service` ist konstant
 * ("WebAIBuilder"); der `account` kodiert Art und Identität des Secrets:
 *
 *   Key-Naming-Schema (M3 — auch von der Deploy-Engine wiederverwendet):
 *     account = `<kind>:<id>`
 *       apikey:<provider>   API-Key eines KI-Providers (anthropic | openai | …)
 *       deploy:<targetId>   Zugangsdaten eines Deploy-Ziels (packages/deploy, M3)
 *
 *   Der `credentialRef` eines DeployTarget (packages/core) verweist auf so einen
 *   Eintrag; die Deploy-UI ruft dafür `setSecret('deploy', targetId, …)`.
 *
 * Robustheit (PLAN §4, Sicherheit): Fehlt ein Systemschlüsselbund (headless
 * Linux, Sway/Hyprland ohne Secret Service), darf die App NICHT crashen und
 * schreibt KEINEN stillen Klartext. Ein Selbsttest beim Start erkennt das; der
 * Dienst fällt dann auf einen reinen In-Memory-Speicher für die laufende Sitzung
 * zurück (`keychainAvailable()` meldet das inkl. Grund an die UI).
 *
 * Nur im Main-Prozess importierbar (native Abhängigkeit). Der Klartext eines
 * Secrets wird nie geloggt und nie an den Renderer gegeben.
 */

import { Entry } from '@napi-rs/keyring';

import {
  effectiveProvider,
  type ActiveBackendId,
  type ByokProvider,
} from '../shared/settings';

/** Konstanter Schlüsselbund-Dienstname. */
export const KEYCHAIN_SERVICE = 'WebAIBuilder';

/** Art eines Secrets — bestimmt das `account`-Präfix. */
export type SecretKind = 'apikey' | 'deploy';

/** Ergebnis des Schlüsselbund-Selbsttests. */
export interface KeychainStatus {
  /** true = OS-Schlüsselbund nutzbar; false = In-Memory-Fallback aktiv. */
  available: boolean;
  /** Technischer Grund, falls nicht verfügbar (nicht für Endnutzer-Copy). */
  reason?: string;
}

/**
 * Minimaler synchroner Keyring-Eintrag — die von uns genutzte Teilmenge von
 * `@napi-rs/keyring`s `Entry`. Als Interface, damit Tests einen Eintrag
 * injizieren können, der Backend-Ausfälle deterministisch simuliert.
 */
export interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

/** Baut einen Eintrag für (service, account). Injizierbar für Tests. */
export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

const defaultEntryFactory: KeyringEntryFactory = (service, account) =>
  new Entry(service, account);

/** account-String aus Art + Id (das dokumentierte Key-Naming-Schema). */
export function secretAccount(kind: SecretKind, id: string): string {
  return `${kind}:${id}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface SecretsServiceOptions {
  /** Schlüsselbund-Dienstname (Default: "WebAIBuilder"). */
  service?: string;
  /** Eintrags-Fabrik (Default: echter `@napi-rs/keyring`-`Entry`). */
  entryFactory?: KeyringEntryFactory;
  /**
   * Erzwingt den In-Memory-Fallback ohne Schlüsselbund-Zugriff. Für Tests und
   * bewusst headless betriebene Umgebungen.
   */
  forceFallback?: boolean;
}

/**
 * Secrets über einen konstanten `service`-Namen. Sitzt entweder auf dem echten
 * OS-Schlüsselbund oder — wenn dieser fehlt/ausfällt — auf einem In-Memory-Store
 * hinter derselben Schnittstelle. Der Fallback aktiviert sich beim Selbsttest
 * oder bei einem unerwarteten Backend-Fehler zur Laufzeit (fail-safe, nie Crash).
 */
export class SecretsService {
  private readonly service: string;
  private readonly entryFactory: KeyringEntryFactory;
  private readonly memory = new Map<string, string>();
  private status: KeychainStatus;

  constructor(options: SecretsServiceOptions = {}) {
    this.service = options.service ?? KEYCHAIN_SERVICE;
    this.entryFactory = options.entryFactory ?? defaultEntryFactory;
    this.status = options.forceFallback === true
      ? { available: false, reason: 'Fallback erzwungen.' }
      : this.probe();
  }

  /** Aktueller Schlüsselbund-Status (Renderer bekommt nur `available`). */
  keychainAvailable(): KeychainStatus {
    return { ...this.status };
  }

  /* ---------------- Generische Secrets (auch für die Deploy-Engine) ---------------- */

  /** Legt ein Secret ab. Leerer Wert = löschen. */
  setSecret(kind: SecretKind, id: string, value: string): void {
    const account = secretAccount(kind, id);
    if (value === '') {
      this.remove(account);
      return;
    }
    this.write(account, value);
  }

  /** Liest ein Secret oder null, wenn keins hinterlegt ist. */
  getSecret(kind: SecretKind, id: string): string | null {
    return this.read(secretAccount(kind, id));
  }

  /** Löscht ein Secret. true, wenn eins entfernt wurde. */
  deleteSecret(kind: SecretKind, id: string): boolean {
    return this.remove(secretAccount(kind, id));
  }

  /** Liegt ein Secret vor? (ohne den Wert zu offenbaren) */
  hasSecret(kind: SecretKind, id: string): boolean {
    const value = this.getSecret(kind, id);
    return value !== null && value !== '';
  }

  /* ---------------- API-Keys (pro Provider, backend-übergreifend geteilt) ---------------- */

  /** Setzt den API-Key des effektiven Providers. Leerer Key = löschen. */
  setApiKey(backendId: ActiveBackendId, provider: ByokProvider, key: string): void {
    this.setSecret('apikey', effectiveProvider(backendId, provider), key.trim());
  }

  getApiKey(backendId: ActiveBackendId, provider: ByokProvider): string | null {
    return this.getSecret('apikey', effectiveProvider(backendId, provider));
  }

  deleteApiKey(backendId: ActiveBackendId, provider: ByokProvider): boolean {
    return this.deleteSecret('apikey', effectiveProvider(backendId, provider));
  }

  hasApiKey(backendId: ActiveBackendId, provider: ByokProvider): boolean {
    return this.hasSecret('apikey', effectiveProvider(backendId, provider));
  }

  /* ---------------- Interna: Schlüsselbund mit fail-safe Fallback ---------------- */

  /**
   * Selbsttest: ein Sentinel-Eintrag wird geschrieben, gelesen und wieder
   * gelöscht (hinterlässt nichts). Wirft eine Operation, gilt der Schlüsselbund
   * als nicht verfügbar.
   */
  private probe(): KeychainStatus {
    const account = secretAccount('apikey', '__probe__');
    const sentinel = 'wab-keychain-probe';
    try {
      const entry = this.entryFactory(this.service, account);
      entry.setPassword(sentinel);
      const read = entry.getPassword();
      entry.deleteCredential();
      if (read !== sentinel) {
        return { available: false, reason: 'Schlüsselbund-Selbsttest lieferte falschen Wert.' };
      }
      return { available: true };
    } catch (error) {
      return { available: false, reason: describeError(error) };
    }
  }

  /** Degradiert dauerhaft auf den In-Memory-Store (fail-safe, kein Crash). */
  private degrade(error: unknown): void {
    if (this.status.available) {
      this.status = { available: false, reason: describeError(error) };
    }
  }

  private write(account: string, value: string): void {
    if (this.status.available) {
      try {
        this.entryFactory(this.service, account).setPassword(value);
        return;
      } catch (error) {
        this.degrade(error);
      }
    }
    this.memory.set(account, value);
  }

  private read(account: string): string | null {
    if (this.status.available) {
      try {
        return this.entryFactory(this.service, account).getPassword();
      } catch (error) {
        this.degrade(error);
      }
    }
    return this.memory.get(account) ?? null;
  }

  private remove(account: string): boolean {
    if (this.status.available) {
      try {
        return this.entryFactory(this.service, account).deleteCredential();
      } catch (error) {
        // NoEntry ist kein Backend-Ausfall — nur "nichts zu löschen".
        if (isNoEntry(error)) return false;
        this.degrade(error);
      }
    }
    return this.memory.delete(account);
  }
}

/** Erkennt den "kein Eintrag vorhanden"-Fehler des Keyrings (kein Backend-Ausfall). */
function isNoEntry(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return message.includes('no matching entry') || message.includes('no entry');
}

/* ------------------------------------------------------------------ */
/* Singleton pro App-Lauf.                                            */
/* ------------------------------------------------------------------ */

let instance: SecretsService | null = null;

export function getSecretsService(): SecretsService {
  instance ??= new SecretsService();
  return instance;
}
