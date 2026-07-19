/**
 * Persistence of the first-run onboarding state in the main process (M5, PLAN §6).
 *
 * A simple JSON file under `<userData>/onboarding-state.json` (no DB schema),
 * with an injectable path → headless testable with vitest. Contains NO secrets,
 * only the `hasOnboarded` flag (+ an optional completion timestamp).
 *
 * The "should onboarding be shown?" logic deliberately lives in
 * shared/onboarding.ts (environment-neutral, shared & tested separately).
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
  /** Time source for an automatically set completion timestamp. */
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
   * Applies a (partial) update and persists. When `hasOnboarded` is set to true
   * for the first time and no completion timestamp exists yet, the store sets it
   * automatically (informational only).
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
      /* Corrupt file → default (onboarding is then shown), don't crash. */
    }
    return coerceOnboardingState(undefined);
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
    } catch {
      /* Best effort — the in-memory state remains authoritative. */
    }
  }
}
