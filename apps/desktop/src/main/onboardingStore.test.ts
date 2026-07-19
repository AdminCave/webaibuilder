/**
 * Headless tests of the onboarding store (Node, without Electron). Path injected.
 * Verifies persistence + "should it be shown?" behavior across a restart.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { shouldShowOnboarding } from '../shared/onboarding';
import { OnboardingStore } from './onboardingStore';

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wab-onboarding-'));
  filePath = join(dir, 'onboarding-state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('OnboardingStore', () => {
  it('shows the onboarding on the very first start (no file)', () => {
    const store = new OnboardingStore(filePath);
    expect(store.get().hasOnboarded).toBe(false);
    expect(shouldShowOnboarding(store.get())).toBe(true);
  });

  it('persists hasOnboarded and sets a completion timestamp', () => {
    const store = new OnboardingStore(filePath, {
      now: () => new Date('2026-07-13T12:00:00.000Z'),
    });
    const next = store.set({ hasOnboarded: true });
    expect(next.hasOnboarded).toBe(true);
    expect(next.completedAt).toBe('2026-07-13T12:00:00.000Z');

    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    expect(parsed['hasOnboarded']).toBe(true);
    expect(parsed['completedAt']).toBe('2026-07-13T12:00:00.000Z');
  });

  it('survives a restart (a second store reads the state)', () => {
    const first = new OnboardingStore(filePath);
    first.set({ hasOnboarded: true });

    const second = new OnboardingStore(filePath);
    expect(second.get().hasOnboarded).toBe(true);
    expect(shouldShowOnboarding(second.get())).toBe(false);
  });

  it('allows showing it again (hasOnboarded back to false)', () => {
    const store = new OnboardingStore(filePath);
    store.set({ hasOnboarded: true });
    expect(shouldShowOnboarding(store.get())).toBe(false);

    // "Show the intro again" resets the flag.
    store.set({ hasOnboarded: false });
    expect(store.get().hasOnboarded).toBe(false);
    expect(shouldShowOnboarding(store.get())).toBe(true);
  });

  it('falls back to the default on a corrupt file (shows the onboarding)', () => {
    // Deliberately write invalid JSON to disk.
    writeFileSync(filePath, '{ this is not json');
    const store = new OnboardingStore(filePath);
    expect(store.get().hasOnboarded).toBe(false);
    expect(shouldShowOnboarding(store.get())).toBe(true);
  });
});
