/**
 * Headless tests of the append-only deploy history log (temporary JSON file,
 * injected id/time source for determinism).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeployHistoryRecord } from '../shared/deploy';
import { DeployHistoryStore, type DeployHistoryInput } from './deployHistory';

let tmp: string;
let filePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wab-deploy-history-'));
  filePath = join(tmp, 'deploy-history.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function record(overrides: Partial<DeployHistoryInput> = {}): DeployHistoryInput {
  return {
    projectId: 'p1',
    targetId: 't1',
    targetName: 'IONOS',
    kind: 'deploy',
    sha: 'abc1234',
    uploaded: 3,
    deleted: 1,
    unchanged: 5,
    bytesUploaded: 2048,
    ok: true,
    ...overrides,
  };
}

function storeWith(clock: string[]): DeployHistoryStore {
  let i = 0;
  let n = 0;
  return new DeployHistoryStore(filePath, {
    idFactory: () => `rec-${(n += 1)}`,
    now: () => new Date(clock[i++] ?? '2026-07-12T00:00:00.000Z'),
  });
}

describe('append / list', () => {
  it('assigns id + timestamp and returns the entry', () => {
    const store = storeWith(['2026-07-12T10:00:00.000Z']);
    const rec = store.append(record());
    expect(rec.id).toBe('rec-1');
    expect(rec.at).toBe('2026-07-12T10:00:00.000Z');
    expect(rec.sha).toBe('abc1234');
  });

  it('lists newest first', () => {
    const store = storeWith([
      '2026-07-12T10:00:00.000Z',
      '2026-07-12T11:00:00.000Z',
      '2026-07-12T12:00:00.000Z',
    ]);
    store.append(record({ sha: 'a' }));
    store.append(record({ sha: 'b' }));
    store.append(record({ sha: 'c' }));
    expect(store.list().map((r) => r.sha)).toEqual(['c', 'b', 'a']);
  });

  it('filters by project', () => {
    const store = storeWith(['t0', 't1', 't2'].map((_, k) => `2026-07-12T1${k}:00:00.000Z`));
    store.append(record({ projectId: 'p1', sha: 'x' }));
    store.append(record({ projectId: 'p2', sha: 'y' }));
    store.append(record({ projectId: 'p1', sha: 'z' }));
    expect(store.list('p1').map((r) => r.sha)).toEqual(['z', 'x']);
    expect(store.list('p2').map((r) => r.sha)).toEqual(['y']);
  });
});

describe('persistence', () => {
  it('survives reopening (same file)', () => {
    const first = storeWith(['2026-07-12T10:00:00.000Z']);
    first.append(record({ sha: 'persist', ok: false, error: 'kaputt' }));

    const second = new DeployHistoryStore(filePath);
    const list = second.list('p1');
    expect(list).toHaveLength(1);
    const only = list[0] as DeployHistoryRecord;
    expect(only.sha).toBe('persist');
    expect(only.ok).toBe(false);
    expect(only.error).toBe('kaputt');
  });

  it('starts empty when the file is missing', () => {
    const store = new DeployHistoryStore(join(tmp, 'gibts-nicht.json'));
    expect(store.list()).toEqual([]);
  });
});
