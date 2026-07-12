/**
 * Erst-Start-Onboarding (M5, PLAN §6): der leichte deutsche Willkommens-Flow,
 * der nur beim ersten Start erscheint. Diese Datei hält den persistenten Zustand
 * (`hasOnboarded`) und die reine Schritt-Logik des Flows — bewusst
 * umgebungsneutral (kein node/electron/DOM), damit sie headless testbar bleibt
 * und von main, preload und renderer gemeinsam genutzt werden kann.
 *
 * Persistenz liegt im Main-Prozess (`<userData>/onboarding-state.json`, siehe
 * main/onboardingStore.ts); der Renderer liest/setzt den Zustand nur über die
 * typisierte Bridge.
 */

/**
 * Persistierter Onboarding-Zustand. Bewusst minimal: ein einziges Flag plus ein
 * optionaler Abschluss-Zeitstempel (nur informativ). Kein Wizard-Framework.
 */
export interface OnboardingState {
  /** Wurde das Onboarding schon einmal abgeschlossen oder übersprungen? */
  hasOnboarded: boolean;
  /** ISO-Zeitpunkt des Abschlusses (nur informativ). */
  completedAt?: string;
}

/** Was der Renderer setzen darf. Fehlende Felder bleiben unverändert. */
export interface OnboardingStateInput {
  hasOnboarded?: boolean;
  completedAt?: string;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = { hasOnboarded: false };

/**
 * Soll das Onboarding gezeigt werden? Fail-open: unbekannter/kaputter Zustand
 * (null) → zeigen. Nur ein explizit gesetztes `hasOnboarded === true` unterdrückt
 * es. So sieht der Nutzer den Flow im Zweifel einmal zu viel statt nie.
 */
export function shouldShowOnboarding(state: OnboardingState | null | undefined): boolean {
  return state?.hasOnboarded !== true;
}

/** Liest einen unbekannten (von der Platte gelesenen) Wert defensiv ein. */
export function coerceOnboardingState(value: unknown): OnboardingState {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
  const raw = value as Record<string, unknown>;
  const state: OnboardingState = { hasOnboarded: raw['hasOnboarded'] === true };
  if (typeof raw['completedAt'] === 'string') state.completedAt = raw['completedAt'];
  return state;
}

/** Führt ein (Teil-)Update in einen gültigen, vollständigen Zustand zusammen. */
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
/* Schritt-Automat des Flows (reiner Reducer, renderer-seitig genutzt) */
/* ------------------------------------------------------------------ */

/**
 * Die Schritte des Flows, in Reihenfolge. Bewusst nur drei Inhaltsscreens
 * (PLAN §6): Willkommen · KI wählen · Webspace-Hinweis. „Fertig" ist die Aktion
 * auf dem letzten Schritt, kein eigener Screen.
 */
export const ONBOARDING_STEPS = ['willkommen', 'ki', 'webspace'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingViewState {
  /** Index in {@link ONBOARDING_STEPS}. */
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
 * Reiner Reducer für die Schritt-Navigation. Klemmt den Index immer in die
 * gültige Spanne — „weiter" am letzten Schritt bleibt stehen (der Screen zeigt
 * dort „Fertig"), „zurück" am ersten Schritt bleibt bei 0.
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

/** 1-basierte Schrittnummer für die Anzeige („Schritt x von n"). */
export function stepNumber(state: OnboardingViewState): number {
  return clampIndex(state.index) + 1;
}

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;
