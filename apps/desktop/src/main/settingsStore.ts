/**
 * Persistenz der KI-Backend-Einstellungen im Main-Prozess.
 *
 * Secret-freie Daten (Backend, Provider, Modell) landen als JSON unter
 * `<userData>/agent-settings.json`. Der API-Key wird bewusst NICHT auf die
 * Platte geschrieben (PLAN §4, Linux-Plaintext-Falle) — er liegt seit M3 im
 * OS-Schlüsselbund (secrets.ts) bzw. bei fehlendem Schlüsselbund nur im Speicher
 * für die laufende Sitzung. Der Store hält nur das abgeleitete `hasApiKey`-Flag.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  backendDisplayName,
  isSubscriptionBackend,
  subscriptionActivationError,
  type BackendPickerState,
} from '../shared/backends';
import {
  coerceAgentSettings,
  effectiveModel,
  mergeAgentSettings,
  type AgentSettings,
  type AgentSettingsData,
  type AgentSettingsInput,
} from '../shared/settings';
import type { SecretsService } from './secrets';

export class AgentSettingsStore {
  private data: AgentSettingsData;

  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretsService,
  ) {
    this.data = this.load();
  }

  private load(): AgentSettingsData {
    try {
      if (existsSync(this.filePath)) {
        return coerceAgentSettings(JSON.parse(readFileSync(this.filePath, 'utf8')));
      }
    } catch {
      /* Kaputte Datei → Defaults, nicht crashen. */
    }
    return coerceAgentSettings(undefined);
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      // Nur die secret-freien Felder — niemals der API-Key (coerceAgentSettings
      // stellt sicher, dass `this.data` keine Fremdfelder trägt).
      writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
    } catch {
      /* Best effort — der In-Memory-Zustand bleibt führend. */
    }
  }

  /**
   * Renderer-taugliche Sicht: secret-frei plus abgeleitete Flags. `hasApiKey`
   * bezieht sich auf das aktuelle Backend/Provider, `keychainAvailable` meldet,
   * ob der OS-Schlüsselbund genutzt wird oder der In-Memory-Fallback aktiv ist.
   */
  get(): AgentSettings {
    // Abo-/CLI-Backends haben keinen app-verwalteten Key — `hasApiKey` darf sie
    // nicht gaten (der Login liegt allein bei der Vendor-CLI, PLAN §3).
    const hasApiKey = isSubscriptionBackend(this.data.backendId)
      ? false
      : this.secrets.hasApiKey(this.data.backendId, this.data.provider);
    return {
      ...this.data,
      hasApiKey,
      keychainAvailable: this.secrets.keychainAvailable().available,
    };
  }

  /**
   * Wendet ein Update an. `apiKey`: string setzt, null (oder leer) löscht,
   * undefined lässt den bestehenden Key unverändert. Nur die secret-freien
   * Felder werden persistiert; der Key geht in den Schlüsselbund. Die
   * secret-freien Felder werden zuerst gemischt, damit der Key unter dem NEU
   * gewählten Backend/Provider abgelegt wird.
   */
  set(input: AgentSettingsInput): AgentSettings {
    this.data = mergeAgentSettings(this.data, input);
    if (input.apiKey !== undefined) {
      const key = input.apiKey === null ? '' : input.apiKey.trim();
      if (key === '') {
        this.secrets.deleteApiKey(this.data.backendId, this.data.provider);
      } else {
        this.secrets.setApiKey(this.data.backendId, this.data.provider, key);
      }
    }
    this.persist();
    return this.get();
  }

  /**
   * Der API-Key für `createBackend` (nur im Main-Prozess), oder undefined.
   * Für Abo-/CLI-Backends immer undefined — sie nutzen den eigenen Login der
   * Vendor-CLI und bekommen von der App keinen Key (PLAN §3).
   */
  currentApiKey(): string | undefined {
    if (isSubscriptionBackend(this.data.backendId)) return undefined;
    return this.secrets.getApiKey(this.data.backendId, this.data.provider) ?? undefined;
  }

  /** Effektiv zu verwendendes Modell (Override oder Provider-Default). */
  currentModel(): string {
    return effectiveModel(this.data);
  }

  currentBackendId(): AgentSettingsData['backendId'] {
    return this.data.backendId;
  }
}

/** Nur der von {@link applySettingsUpdate} benötigte Teil des BackendService. */
export interface SubscriptionReadinessSource {
  availability(): Promise<BackendPickerState>;
}

/**
 * Wendet ein Einstellungs-Update an und setzt dabei die AUTORITATIVE
 * Aktivierungsprüfung für Abo-Backends durch (PLAN §3/§4): Wird als aktives
 * Backend ein Abo-Backend gewählt, muss es nach derselben Erkennung +
 * Kill-Switch + Bestätigung, die auch die UI sieht, nutzbar sein — sonst wird
 * das Update mit einer deutschen, handlungsleitenden Meldung abgelehnt und NICHT
 * persistiert. So kann `appSession` nie eine CLI starten, die der Nutzer gar
 * nicht verwenden kann. API-Key-Backends laufen ungehindert durch.
 */
export async function applySettingsUpdate(
  store: AgentSettingsStore,
  readiness: SubscriptionReadinessSource,
  input: AgentSettingsInput,
): Promise<AgentSettings> {
  const target = input.backendId;
  if (target !== undefined && isSubscriptionBackend(target)) {
    const state = await readiness.availability();
    const view = state.backends.find((b) => b.backendId === target);
    const message =
      view === undefined
        ? `${backendDisplayName(target)} ist nicht verfügbar.`
        : subscriptionActivationError(view);
    if (message !== null) throw new Error(message);
  }
  return store.set(input);
}
