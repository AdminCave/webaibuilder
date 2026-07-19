/**
 * Deploy history (M3, PLAN §4/§6): append-only log of the deploys/rollbacks per
 * project as a JSON file under `<userData>/deploy-history.json`.
 *
 * Deliberately a simple JSON file (no DB schema migration effort) with an
 * injectable path → headless testable with vitest. Contains NO secrets, only
 * the target name/id, deployed SHA, time, and the run's counters.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { DeployHistoryRecord } from '../shared/deploy';

/** A new history entry without the fields assigned by the store. */
export type DeployHistoryInput = Omit<DeployHistoryRecord, 'id' | 'at'>;

export interface DeployHistoryStoreOptions {
  /** Unique entry IDs (default: randomUUID). */
  idFactory?: () => string;
  /** Time source (default: Date.now via new Date()). */
  now?: () => Date;
}

export class DeployHistoryStore {
  private records: DeployHistoryRecord[];
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly filePath: string,
    options: DeployHistoryStoreOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.records = this.load();
  }

  /** Appends an entry and persists; returns the complete record. */
  append(input: DeployHistoryInput): DeployHistoryRecord {
    const record: DeployHistoryRecord = {
      ...input,
      id: this.idFactory(),
      at: this.now().toISOString(),
    };
    this.records.push(record);
    this.persist();
    return record;
  }

  /** History (newest first), optionally filtered to a project. */
  list(projectId?: string): DeployHistoryRecord[] {
    const filtered =
      projectId === undefined
        ? this.records
        : this.records.filter((r) => r.projectId === projectId);
    return [...filtered].sort((a, b) => b.at.localeCompare(a.at));
  }

  /* ---------------- internal ---------------- */

  private load(): DeployHistoryRecord[] {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
        if (Array.isArray(parsed)) return parsed as DeployHistoryRecord[];
      }
    } catch {
      /* Corrupt/missing file → empty history, don't crash. */
    }
    return [];
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(this.records, null, 2)}\n`);
    } catch {
      /* Best effort — the in-memory state remains authoritative. */
    }
  }
}
