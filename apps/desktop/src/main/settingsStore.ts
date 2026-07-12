/**
 * Persistenz der KI-Backend-Einstellungen im Main-Prozess.
 *
 * Secret-freie Daten (Backend, Provider, Modell) landen als JSON unter
 * `<userData>/agent-settings.json`. Der API-Key wird bewusst NICHT auf die
 * Platte geschrieben (PLAN §4, Linux-Plaintext-Falle) — er lebt nur im Speicher
 * für die laufende Sitzung.
 * TODO(M3): Key in den OS-Schlüsselbund (@napi-rs/keyring) verschieben.
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

export class AgentSettingsStore {
  private data: AgentSettingsData;
  private apiKey: string | null = null;

  constructor(private readonly filePath: string) {
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
      writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
    } catch {
      /* Best effort — der In-Memory-Zustand bleibt führend. */
    }
  }

  /** Renderer-taugliche Sicht: secret-frei plus hasApiKey-Flag. */
  get(): AgentSettings {
    return { ...this.data, hasApiKey: this.apiKey !== null && this.apiKey !== '' };
  }

  /**
   * Wendet ein Update an. `apiKey`: string setzt, null löscht, undefined lässt
   * den bestehenden Key unverändert. Nur die secret-freien Felder werden
   * persistiert.
   */
  set(input: AgentSettingsInput): AgentSettings {
    this.data = mergeAgentSettings(this.data, input);
    if (input.apiKey !== undefined) {
      const key = input.apiKey === null ? '' : input.apiKey.trim();
      this.apiKey = key === '' ? null : key;
    }
    this.persist();
    return this.get();
  }

  /** Der API-Key für `createBackend` (nur im Main-Prozess), oder undefined. */
  currentApiKey(): string | undefined {
    return this.apiKey ?? undefined;
  }

  /** Effektiv zu verwendendes Modell (Override oder Provider-Default). */
  currentModel(): string {
    return effectiveModel(this.data);
  }

  currentBackendId(): AgentSettingsData['backendId'] {
    return this.data.backendId;
  }
}
