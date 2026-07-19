/**
 * First-launch onboarding (M5, PLAN §6): the lightweight welcome flow that only
 * appears on the first launch. This file holds the persistent state
 * (`hasOnboarded`) and the pure step logic of the flow — deliberately
 * environment-neutral (no node/electron/DOM) so it stays headless-testable and
 * can be shared by main, preload, and renderer.
 *
 * Persistence lives in the main process (`<userData>/onboarding-state.json`, see
 * main/onboardingStore.ts); the renderer only reads/sets the state via the typed
 * bridge.
 */

/**
 * Persisted onboarding state. Deliberately minimal: a single flag plus an
 * optional completion timestamp (informational only). No wizard framework.
 */
export interface OnboardingState {
  /** Has the onboarding already been completed or skipped once? */
  hasOnboarded: boolean;
  /** ISO timestamp of completion (informational only). */
  completedAt?: string;
}

/** What the renderer may set. Missing fields stay unchanged. */
export interface OnboardingStateInput {
  hasOnboarded?: boolean;
  completedAt?: string;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = { hasOnboarded: false };

/**
 * Should the onboarding be shown? Fail-open: an unknown/broken state (null) →
 * show it. Only an explicitly set `hasOnboarded === true` suppresses it. That
 * way, in case of doubt, the user sees the flow one time too many rather than
 * never.
 */
export function shouldShowOnboarding(state: OnboardingState | null | undefined): boolean {
  return state?.hasOnboarded !== true;
}

/** Defensively parses an unknown (disk-read) value. */
export function coerceOnboardingState(value: unknown): OnboardingState {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
  const raw = value as Record<string, unknown>;
  const state: OnboardingState = { hasOnboarded: raw['hasOnboarded'] === true };
  if (typeof raw['completedAt'] === 'string') state.completedAt = raw['completedAt'];
  return state;
}

/** Merges a (partial) update into a valid, complete state. */
export function mergeOnboardingState(
  current: OnboardingState,
  patch: OnboardingStateInput,
): OnboardingState {
  const next: OnboardingState = {
    hasOnboarded: patch.hasOnboarded ?? current.hasOnboarded,
  };
  const completedAt = patch.completedAt ?? current.completedAt;
  if (completedAt !== undefined) next.completedAt = completedAt;
  return next;
}

/* ------------------------------------------------------------------ */
/* Step state machine of the flow (pure reducer, used on the renderer) */
/* ------------------------------------------------------------------ */

/**
 * The steps of the flow, in order. Deliberately only three content screens
 * (PLAN §6): Welcome · Choose AI · Webspace notice. "Done" is the action on the
 * last step, not a screen of its own.
 */
export const ONBOARDING_STEPS = ['welcome', 'ai', 'webspace'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingViewState {
  /** Index into {@link ONBOARDING_STEPS}. */
  index: number;
}

export type OnboardingAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; index: number };

export const INITIAL_ONBOARDING_VIEW: OnboardingViewState = { index: 0 };

function clampIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Math.trunc(index)));
}

/**
 * Pure reducer for step navigation. Always clamps the index into the valid range
 * — "next" on the last step stays put (the screen shows "Done" there), "back" on
 * the first step stays at 0.
 */
export function onboardingReducer(
  state: OnboardingViewState,
  action: OnboardingAction,
): OnboardingViewState {
  switch (action.type) {
    case 'next':
      return { index: clampIndex(state.index + 1) };
    case 'back':
      return { index: clampIndex(state.index - 1) };
    case 'goto':
      return { index: clampIndex(action.index) };
    default:
      return state;
  }
}

export function currentStep(state: OnboardingViewState): OnboardingStep {
  return ONBOARDING_STEPS[clampIndex(state.index)] as OnboardingStep;
}

export function isFirstStep(state: OnboardingViewState): boolean {
  return clampIndex(state.index) === 0;
}

export function isLastStep(state: OnboardingViewState): boolean {
  return clampIndex(state.index) === ONBOARDING_STEPS.length - 1;
}

/** 1-based step number for display ("Step x of n"). */
export function stepNumber(state: OnboardingViewState): number {
  return clampIndex(state.index) + 1;
}

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;
