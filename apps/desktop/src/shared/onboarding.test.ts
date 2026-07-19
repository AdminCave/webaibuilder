import { describe, expect, it } from 'vitest';

import {
  coerceOnboardingState,
  currentStep,
  DEFAULT_ONBOARDING_STATE,
  INITIAL_ONBOARDING_VIEW,
  isFirstStep,
  isLastStep,
  mergeOnboardingState,
  onboardingReducer,
  ONBOARDING_STEP_COUNT,
  shouldShowOnboarding,
  stepNumber,
  type OnboardingViewState,
} from './onboarding';

describe('shouldShowOnboarding', () => {
  it('shows on first launch and for an unknown state (fail-open)', () => {
    expect(shouldShowOnboarding(null)).toBe(true);
    expect(shouldShowOnboarding(undefined)).toBe(true);
    expect(shouldShowOnboarding(DEFAULT_ONBOARDING_STATE)).toBe(true);
    expect(shouldShowOnboarding({ hasOnboarded: false })).toBe(true);
  });

  it('suppresses it only when onboarding is explicitly completed', () => {
    expect(shouldShowOnboarding({ hasOnboarded: true })).toBe(false);
  });
});

describe('coerceOnboardingState', () => {
  it('returns the default for non-objects', () => {
    expect(coerceOnboardingState(undefined)).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(coerceOnboardingState('kaputt')).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(coerceOnboardingState(42)).toEqual(DEFAULT_ONBOARDING_STATE);
  });

  it('reads hasOnboarded strictly as a bool (only true counts)', () => {
    expect(coerceOnboardingState({ hasOnboarded: true })).toEqual({ hasOnboarded: true });
    expect(coerceOnboardingState({ hasOnboarded: 'yes' })).toEqual({ hasOnboarded: false });
    expect(coerceOnboardingState({})).toEqual({ hasOnboarded: false });
  });

  it('keeps a valid completion timestamp, ignores foreign fields', () => {
    const state = coerceOnboardingState({
      hasOnboarded: true,
      completedAt: '2026-07-13T00:00:00.000Z',
      hack: 'x',
    });
    expect(state).toEqual({ hasOnboarded: true, completedAt: '2026-07-13T00:00:00.000Z' });
    expect(state).not.toHaveProperty('hack');
  });
});

describe('mergeOnboardingState', () => {
  it('leaves unchanged fields as they are', () => {
    const current = { hasOnboarded: false };
    expect(mergeOnboardingState(current, {})).toEqual(current);
  });

  it('sets hasOnboarded and adopts completedAt', () => {
    const next = mergeOnboardingState(
      { hasOnboarded: false },
      { hasOnboarded: true, completedAt: '2026-07-13T00:00:00.000Z' },
    );
    expect(next).toEqual({ hasOnboarded: true, completedAt: '2026-07-13T00:00:00.000Z' });
  });
});

describe('onboardingReducer — step navigation', () => {
  it('starts at the first step', () => {
    expect(INITIAL_ONBOARDING_VIEW).toEqual({ index: 0 });
    expect(isFirstStep(INITIAL_ONBOARDING_VIEW)).toBe(true);
    expect(currentStep(INITIAL_ONBOARDING_VIEW)).toBe('welcome');
  });

  it('moves forward with "next" and stops at the last step', () => {
    let state: OnboardingViewState = INITIAL_ONBOARDING_VIEW;
    for (let i = 0; i < ONBOARDING_STEP_COUNT + 3; i++) {
      state = onboardingReducer(state, { type: 'next' });
    }
    expect(state.index).toBe(ONBOARDING_STEP_COUNT - 1);
    expect(isLastStep(state)).toBe(true);
    expect(currentStep(state)).toBe('webspace');
  });

  it('moves back with "back" and stops at 0', () => {
    let state: OnboardingViewState = { index: 1 };
    state = onboardingReducer(state, { type: 'back' });
    expect(state.index).toBe(0);
    state = onboardingReducer(state, { type: 'back' });
    expect(state.index).toBe(0);
  });

  it('clamps "goto" into the valid range', () => {
    expect(onboardingReducer(INITIAL_ONBOARDING_VIEW, { type: 'goto', index: 99 }).index).toBe(
      ONBOARDING_STEP_COUNT - 1,
    );
    expect(onboardingReducer(INITIAL_ONBOARDING_VIEW, { type: 'goto', index: -5 }).index).toBe(0);
    expect(onboardingReducer(INITIAL_ONBOARDING_VIEW, { type: 'goto', index: 1 }).index).toBe(1);
  });

  it('returns a 1-based step number', () => {
    expect(stepNumber({ index: 0 })).toBe(1);
    expect(stepNumber({ index: 2 })).toBe(3);
    // Robust even outside the range (clamped).
    expect(stepNumber({ index: 999 })).toBe(ONBOARDING_STEP_COUNT);
  });
});
