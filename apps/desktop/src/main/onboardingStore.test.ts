/**
 * Headless-Tests des Onboarding-Stores (Node, ohne Electron). Pfad injiziert.
 * Prüft Persistenz + „soll gezeigt werden?"-Verhalten über einen Neustart.
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
  it('zeigt das Onboarding beim allerersten Start (keine Datei)', () => {
    const store = new OnboardingStore(filePath);
    expect(store.get().hasOnboarded).toBe(false);
    expect(shouldShowOnboarding(store.get())).toBe(true);
  });

  it('persistiert hasOnboarded und setzt einen Abschluss-Zeitstempel', () => {
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

  it('überlebt einen Neustart (zweiter Store liest den Zustand)', () => {
    const first = new OnboardingStore(filePath);
    first.set({ hasOnboarded: true });

    const second = new OnboardingStore(filePath);
    expect(second.get().hasOnboarded).toBe(true);
    expect(shouldShowOnboarding(second.get())).toBe(false);
  });

  it('erlaubt das erneute Anzeigen (hasOnboarded zurück auf false)', () => {
    const store = new OnboardingStore(filePath);
    store.set({ hasOnboarded: true });
    expect(shouldShowOnboarding(store.get())).toBe(false);

    // „Einführung erneut zeigen" setzt das Flag zurück.
    store.set({ hasOnboarded: false });
    expect(store.get().hasOnboarded).toBe(false);
    expect(shouldShowOnboarding(store.get())).toBe(true);
  });

  it('fällt bei kaputter Datei auf den Default zurück (zeigt das Onboarding)', () => {
    // Absichtlich ungültiges JSON auf die Platte legen.
    writeFileSync(filePath, '{ das ist kein json');
    const store = new OnboardingStore(filePath);
    expect(store.get().hasOnboarded).toBe(false);
    expect(shouldShowOnboarding(store.get())).toBe(true);
  });
});
