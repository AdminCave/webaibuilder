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
    return {
      ...this.data,
      hasApiKey: this.secrets.hasApiKey(this.data.backendId, this.data.provider),
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

  /** Der API-Key für `createBackend` (nur im Main-Prozess), oder undefined. */
  currentApiKey(): string | undefined {
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
