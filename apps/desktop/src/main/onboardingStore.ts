/**
 * Persistenz des Erst-Start-Onboarding-Zustands im Main-Prozess (M5, PLAN §6).
 *
 * Schlichte JSON-Datei unter `<userData>/onboarding-state.json` (kein
 * DB-Schema), injizierbarer Pfad → headless mit vitest testbar. Enthält KEINE
 * Secrets, nur das `hasOnboarded`-Flag (+ optionalen Abschluss-Zeitstempel).
 *
 * Die „soll das Onboarding gezeigt werden?"-Logik lebt bewusst in
 * shared/onboarding.ts (umgebungsneutral, geteilt & separat getestet).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  coerceOnboardingState,
  mergeOnboardingState,
  type OnboardingState,
  type OnboardingStateInput,
} from '../shared/onboarding';

export interface OnboardingStoreOptions {
  /** Zeitquelle für einen automatisch gesetzten Abschluss-Zeitstempel. */
  now?: () => Date;
}

export class OnboardingStore {
  private state: OnboardingState;
  private readonly now: () => Date;

  constructor(
    private readonly filePath: string,
    options: OnboardingStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.state = this.load();
  }

  get(): OnboardingState {
    return { ...this.state };
  }

  /**
   * Wendet ein (Teil-)Update an und persistiert. Wird `hasOnboarded` erstmals auf
   * true gesetzt und ist noch kein Abschluss-Zeitstempel vorhanden, setzt der
   * Store ihn automatisch (nur informativ).
   */
  set(input: OnboardingStateInput): OnboardingState {
    const merged = mergeOnboardingState(this.state, input);
    if (input.hasOnboarded === true && input.completedAt === undefined && merged.completedAt === undefined) {
      merged.completedAt = this.now().toISOString();
    }
    this.state = merged;
    this.persist();
    return this.get();
  }

  private load(): OnboardingState {
    try {
      if (existsSync(this.filePath)) {
        return coerceOnboardingState(JSON.parse(readFileSync(this.filePath, 'utf8')));
      }
    } catch {
      /* Kaputte Datei → Default (Onboarding wird dann gezeigt), nicht crashen. */
    }
    return coerceOnboardingState(undefined);
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
    } catch {
      /* Best effort — der In-Memory-Zustand bleibt führend. */
    }
  }
}
