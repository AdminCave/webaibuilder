/**
 * Backend-Erkennung, Onboarding-Bestätigung und Kill-Switch-Merge (PLAN §3/§4,
 * M4) — Main-Prozess-Orchestrierung.
 *
 *  - `availability()` ruft die (injizierte) Detection, cached ihr Ergebnis und
 *    mergt es bei jedem Aufruf mit dem AKTUELLEN Kill-Switch + Bestätigungen.
 *    Die Detection wird NICHT bei jedem Aufruf neu geprobt (manuelles
 *    „neu prüfen" über `refresh()`); nur der billige Merge läuft jedes Mal frisch.
 *  - Ein per Kill-Switch deaktiviertes Backend wird mit Grund gemeldet.
 *  - Bestätigungen (Claude-Abo-Hinweis) werden persistiert.
 *
 * Die Detection ist bewusst lose typisiert (`readonly unknown[]`), damit additive
 * Änderungen an `BackendAvailability` in @webaibuilder/agents (paralleler Umbau)
 * diese Schicht nicht brechen — jede rohe Zeile wird defensiv normalisiert.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { BackendId } from '@webaibuilder/core';

import {
  ALL_BACKEND_IDS,
  buildAvailabilityViews,
  coerceRawAvailability,
  type BackendPickerState,
  type KillSwitchConfig,
  type RawBackendAvailability,
} from '../shared/backends';

/** Rohe Backend-Detection (z. B. `() => detectBackends()`). Lose typisiert. */
export type BackendDetect = () => Promise<readonly unknown[]>;

/** Persistenter Speicher der bestätigten Backend-Hinweise. */
export interface AckStore {
  list(): BackendId[];
  add(id: BackendId): void;
}

/** Kill-Switch-Quelle (nur der synchron benötigte Teil). */
export interface KillSwitchSource {
  effective(): KillSwitchConfig;
}

export interface BackendServiceOptions {
  detect: BackendDetect;
  killSwitch: KillSwitchSource;
  acks: AckStore;
}

export class BackendService {
  private readonly detect: BackendDetect;
  private readonly killSwitch: KillSwitchSource;
  private readonly acks: AckStore;

  /** Gecachte, normalisierte Detection (null = noch nie geprobt). */
  private detected: RawBackendAvailability[] | null = null;

  constructor(options: BackendServiceOptions) {
    this.detect = options.detect;
    this.killSwitch = options.killSwitch;
    this.acks = options.acks;
  }

  /** Aktueller Picker-Zustand (probt einmalig, danach aus dem Cache). */
  async availability(): Promise<BackendPickerState> {
    if (this.detected === null) {
      this.detected = await this.probe();
    }
    return this.build();
  }

  /** Erzwingt eine frische Detection („neu prüfen"). */
  async refresh(): Promise<BackendPickerState> {
    this.detected = await this.probe();
    return this.build();
  }

  /** Bestätigt einen Backend-Hinweis (einmalig, persistiert). */
  async acknowledge(id: BackendId): Promise<BackendPickerState> {
    this.acks.add(id);
    return this.availability();
  }

  /* ---------------- intern ---------------- */

  private async probe(): Promise<RawBackendAvailability[]> {
    let rows: readonly unknown[];
    try {
      rows = await this.detect();
    } catch {
      // Detection-Fehler → alle Backends defensiv „nicht installiert".
      rows = [];
    }
    const out: RawBackendAvailability[] = [];
    for (const row of rows) {
      const raw = coerceRawAvailability(row);
      if (raw !== null) out.push(raw);
    }
    return out;
  }

  private build(): BackendPickerState {
    const acknowledged = new Set<BackendId>(this.acks.list());
    const backends = buildAvailabilityViews(
      this.detected ?? [],
      this.killSwitch.effective(),
      acknowledged,
    );
    return { backends, acknowledged: [...acknowledged] };
  }
}

/* ------------------------------------------------------------------ */
/* Datei-basierter Bestätigungs-Speicher (`<userData>/backend-acks.json`) */
/* ------------------------------------------------------------------ */

const VALID_IDS: ReadonlySet<string> = new Set(ALL_BACKEND_IDS);

/** Persistiert die Liste bestätigter Backend-IDs als JSON-Array. */
export class FileAckStore implements AckStore {
  private ids: BackendId[];

  constructor(private readonly filePath: string) {
    this.ids = this.load();
  }

  list(): BackendId[] {
    return [...this.ids];
  }

  add(id: BackendId): void {
    if (this.ids.includes(id)) return;
    this.ids.push(id);
    this.persist();
  }

  private load(): BackendId[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is BackendId => typeof v === 'string' && VALID_IDS.has(v));
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(this.ids, null, 2)}\n`);
    } catch {
      /* Best effort — der In-Memory-Zustand bleibt führend. */
    }
  }
}
