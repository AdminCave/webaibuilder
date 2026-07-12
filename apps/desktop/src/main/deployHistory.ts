/**
 * Deploy-Historie (M3, PLAN §4/§6): append-only Log der Deploys/Rollbacks pro
 * Projekt als JSON-Datei unter `<userData>/deploy-history.json`.
 *
 * Bewusst als schlichte JSON-Datei (kein DB-Schema-Migrationsaufwand) und
 * injizierbarer Pfad → headless mit vitest testbar. Enthält KEINE Secrets, nur
 * Ziel-Name/-Id, deployte SHA, Zeit und die Zähler des Laufs.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { DeployHistoryRecord } from '../shared/deploy';

/** Ein neuer Historien-Eintrag ohne die vom Store vergebenen Felder. */
export type DeployHistoryInput = Omit<DeployHistoryRecord, 'id' | 'at'>;

export interface DeployHistoryStoreOptions {
  /** Eindeutige Eintrags-IDs (Default: randomUUID). */
  idFactory?: () => string;
  /** Zeitquelle (Default: Date.now via new Date()). */
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

  /** Hängt einen Eintrag an und persistiert; liefert den vollständigen Datensatz. */
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

  /** Historie (neueste zuerst), optional auf ein Projekt gefiltert. */
  list(projectId?: string): DeployHistoryRecord[] {
    const filtered =
      projectId === undefined
        ? this.records
        : this.records.filter((r) => r.projectId === projectId);
    return [...filtered].sort((a, b) => b.at.localeCompare(a.at));
  }

  /* ---------------- intern ---------------- */

  private load(): DeployHistoryRecord[] {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
        if (Array.isArray(parsed)) return parsed as DeployHistoryRecord[];
      }
    } catch {
      /* Kaputte/fehlende Datei → leere Historie, nicht crashen. */
    }
    return [];
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(this.records, null, 2)}\n`);
    } catch {
      /* Best effort — der In-Memory-Zustand bleibt führend. */
    }
  }
}
