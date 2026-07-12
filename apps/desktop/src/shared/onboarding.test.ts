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
  it('zeigt beim ersten Start und bei unbekanntem Zustand (fail-open)', () => {
    expect(shouldShowOnboarding(null)).toBe(true);
    expect(shouldShowOnboarding(undefined)).toBe(true);
    expect(shouldShowOnboarding(DEFAULT_ONBOARDING_STATE)).toBe(true);
    expect(shouldShowOnboarding({ hasOnboarded: false })).toBe(true);
  });

  it('unterdrückt es nur bei explizit abgeschlossenem Onboarding', () => {
    expect(shouldShowOnboarding({ hasOnboarded: true })).toBe(false);
  });
});

describe('coerceOnboardingState', () => {
  it('liefert Default für Nicht-Objekte', () => {
    expect(coerceOnboardingState(undefined)).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(coerceOnboardingState('kaputt')).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(coerceOnboardingState(42)).toEqual(DEFAULT_ONBOARDING_STATE);
  });

  it('liest hasOnboarded strikt als bool (nur true zählt)', () => {
    expect(coerceOnboardingState({ hasOnboarded: true })).toEqual({ hasOnboarded: true });
    expect(coerceOnboardingState({ hasOnboarded: 'yes' })).toEqual({ hasOnboarded: false });
    expect(coerceOnboardingState({})).toEqual({ hasOnboarded: false });
  });

  it('übernimmt einen gültigen Abschluss-Zeitstempel, ignoriert Fremdfelder', () => {
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
  it('lässt unveränderte Felder stehen', () => {
    const current = { hasOnboarded: false };
    expect(mergeOnboardingState(current, {})).toEqual(current);
  });

  it('setzt hasOnboarded und übernimmt completedAt', () => {
    const next = mergeOnboardingState(
      { hasOnboarded: false },
      { hasOnboarded: true, completedAt: '2026-07-13T00:00:00.000Z' },
    );
    expect(next).toEqual({ hasOnboarded: true, completedAt: '2026-07-13T00:00:00.000Z' });
  });
});

describe('onboardingReducer — Schritt-Navigation', () => {
  it('startet beim ersten Schritt', () => {
    expect(INITIAL_ONBOARDING_VIEW).toEqual({ index: 0 });
    expect(isFirstStep(INITIAL_ONBOARDING_VIEW)).toBe(true);
    expect(currentStep(INITIAL_ONBOARDING_VIEW)).toBe('willkommen');
  });

  it('geht mit „next" vorwärts und bleibt am letzten Schritt stehen', () => {
    let state: OnboardingViewState = INITIAL_ONBOARDING_VIEW;
    for (let i = 0; i < ONBOARDING_STEP_COUNT + 3; i++) {
      state = onboardingReducer(state, { type: 'next' });
    }
    expect(state.index).toBe(ONBOARDING_STEP_COUNT - 1);
    expect(isLastStep(state)).toBe(true);
    expect(currentStep(state)).toBe('webspace');
  });

  it('geht mit „back" zurück und bleibt bei 0 stehen', () => {
    let state: OnboardingViewState = { index: 1 };
    state = onboardingReducer(state, { type: 'back' });
    expect(state.index).toBe(0);
    state = onboardingReducer(state, { type: 'back' });
    expect(state.index).toBe(0);
  });

  it('klemmt „goto" in die gültige Spanne', () => {
    expect(onboardingReducer(INITIAL_ONBOARDING_VIEW, { type: 'goto', index: 99 }).index).toBe(
      ONBOARDING_STEP_COUNT - 1,
    );
    expect(onboardingReducer(INITIAL_ONBOARDING_VIEW, { type: 'goto', index: -5 }).index).toBe(0);
    expect(onboardingReducer(INITIAL_ONBOARDING_VIEW, { type: 'goto', index: 1 }).index).toBe(1);
  });

  it('liefert eine 1-basierte Schrittnummer', () => {
    expect(stepNumber({ index: 0 })).toBe(1);
    expect(stepNumber({ index: 2 })).toBe(3);
    // Auch außerhalb der Spanne robust (geklemmt).
    expect(stepNumber({ index: 999 })).toBe(ONBOARDING_STEP_COUNT);
  });
});
