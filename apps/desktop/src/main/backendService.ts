/**
 * Backend detection, onboarding acknowledgment, and kill-switch merge (PLAN §3/§4,
 * M4) — main-process orchestration.
 *
 *  - `availability()` calls the (injected) detection, caches its result, and
 *    merges it on every call with the CURRENT kill switch + acknowledgments.
 *    The detection is NOT re-probed on every call (manual "re-check" via
 *    `refresh()`); only the cheap merge runs fresh each time.
 *  - A backend disabled by the kill switch is reported with a reason.
 *  - Acknowledgments (Claude subscription notice) are persisted.
 *
 * The detection is deliberately loosely typed (`readonly unknown[]`) so that
 * additive changes to `BackendAvailability` in @webaibuilder/agents (parallel
 * refactor) do not break this layer — every raw row is defensively normalized.
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

/** Raw backend detection (e.g. `() => detectBackends()`). Loosely typed. */
export type BackendDetect = () => Promise<readonly unknown[]>;

/** Persistent store of the acknowledged backend notices. */
export interface AckStore {
  list(): BackendId[];
  add(id: BackendId): void;
}

/** Kill-switch source (only the synchronously required part). */
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

  /** Cached, normalized detection (null = never probed yet). */
  private detected: RawBackendAvailability[] | null = null;

  constructor(options: BackendServiceOptions) {
    this.detect = options.detect;
    this.killSwitch = options.killSwitch;
    this.acks = options.acks;
  }

  /** Current picker state (probes once, then from the cache). */
  async availability(): Promise<BackendPickerState> {
    if (this.detected === null) {
      this.detected = await this.probe();
    }
    return this.build();
  }

  /** Forces a fresh detection ("re-check"). */
  async refresh(): Promise<BackendPickerState> {
    this.detected = await this.probe();
    return this.build();
  }

  /** Acknowledges a backend notice (once, persisted). */
  async acknowledge(id: BackendId): Promise<BackendPickerState> {
    this.acks.add(id);
    return this.availability();
  }

  /* ---------------- internal ---------------- */

  private async probe(): Promise<RawBackendAvailability[]> {
    let rows: readonly unknown[];
    try {
      rows = await this.detect();
    } catch {
      // Detection error → all backends defensively "not installed".
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
/* File-based acknowledgment store (`<userData>/backend-acks.json`)        */
/* ------------------------------------------------------------------ */

const VALID_IDS: ReadonlySet<string> = new Set(ALL_BACKEND_IDS);

/** Persists the list of acknowledged backend IDs as a JSON array. */
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
      /* Best effort — the in-memory state remains authoritative. */
    }
  }
}
