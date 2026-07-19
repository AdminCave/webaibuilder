import { useReducer } from 'react';

import {
  currentStep,
  INITIAL_ONBOARDING_VIEW,
  isFirstStep,
  isLastStep,
  onboardingReducer,
  ONBOARDING_STEP_COUNT,
  stepNumber,
  type OnboardingStep,
} from '../../../shared/onboarding';

interface OnboardingProps {
  /** Closes the flow and remembers that it was seen (hasOnboarded=true). */
  onComplete: () => void;
  /** Ends the flow and opens settings (AI backends). */
  onOpenSettings: () => void;
}

/**
 * First-launch onboarding (M5, PLAN §1/§3/§6). Lightweight welcome flow with
 * three screens — Welcome · Choose AI · Web space — no wizard framework.
 * Appears only on first launch (app gated via `onboarding.get`), can be skipped
 * at any time, and can be reopened from settings.
 *
 * Strict AdminCave DS: hairline card, one emphasized action per screen, pill
 * buttons, no emojis, no gradients. The step machine comes from
 * shared/onboarding.ts (pure, tested).
 */
export function Onboarding({ onComplete, onOpenSettings }: OnboardingProps): React.JSX.Element {
  const [view, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING_VIEW);
  const step = currentStep(view);
  const last = isLastStep(view);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Introduction">
      <div className="modal__backdrop" />
      <div className="modal__panel modal__panel--wide onboarding">
        <header className="onboarding__head">
          <span className="onboarding__step">
            Step {stepNumber(view)} of {ONBOARDING_STEP_COUNT}
          </span>
          <button type="button" className="onboarding__skip" onClick={onComplete}>
            Skip
          </button>
        </header>

        <div className="onboarding__body">
          <StepContent step={step} onOpenSettings={onOpenSettings} />
        </div>

        <div className="onboarding__dots" aria-hidden="true">
          {Array.from({ length: ONBOARDING_STEP_COUNT }).map((_, index) => (
            <span
              key={index}
              className={index === view.index ? 'onboarding__dot onboarding__dot--on' : 'onboarding__dot'}
            />
          ))}
        </div>

        <footer className="onboarding__actions">
          <button
            type="button"
            className="btn"
            disabled={isFirstStep(view)}
            onClick={() => dispatch({ type: 'back' })}
          >
            Back
          </button>
          <span className="modal__actions-spacer" />
          {last ? (
            <button type="button" className="btn btn--primary" onClick={onComplete}>
              Get started
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: 'next' })}>
              Next
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepContent({
  step,
  onOpenSettings,
}: {
  step: OnboardingStep;
  onOpenSettings: () => void;
}): React.JSX.Element {
  switch (step) {
    case 'willkommen':
      return (
        <section className="onboarding__screen">
          <h2 className="onboarding__title">Welcome to Web AI Builder</h2>
          <p className="onboarding__lead">Your website. Your AI. Your web space.</p>
          <p className="onboarding__text">
            You build your website through AI chat, see every change instantly in the live preview,
            and publish it to your own web space at the press of a button — with rollback if
            something goes wrong.
          </p>
          <p className="onboarding__text">
            Everything runs locally on your machine. The AI uses your own subscriptions or API keys,
            and the site lives on your own hosting. No cloud in between, no intermediate storage.
          </p>
        </section>
      );
    case 'ki':
      return (
        <section className="onboarding__screen">
          <h2 className="onboarding__title">Choose your AI</h2>
          <p className="onboarding__text">
            You have two options, and you can mix them:
          </p>
          <ul className="onboarding__list">
            <li>
              <span className="onboarding__list-title">Your own API key</span> — you add a key from
              Anthropic, OpenAI, Google, or xAI. The key is stored in your operating system's
              keychain, never in plain text on disk.
            </li>
            <li>
              <span className="onboarding__list-title">Your own subscription via CLI</span> — uses
              your existing subscription (Claude, Codex, Gemini, Grok) through the provider's
              official CLI, which you install and log into yourself.
            </li>
          </ul>
          <p className="onboarding__note">
            Important: this app never stores, proxies, or transmits your provider tokens. With the
            subscription option, login happens exclusively in the provider's own CLI — we only launch
            what you set up yourself.
          </p>
          <div className="onboarding__inline-actions">
            <button type="button" className="btn" onClick={onOpenSettings}>
              Open AI backends
            </button>
            <span className="onboarding__hint">You can also do this later in settings.</span>
          </div>
        </section>
      );
    case 'webspace':
      return (
        <section className="onboarding__screen">
          <h2 className="onboarding__title">Publishing comes later — per project</h2>
          <p className="onboarding__text">
            You set up where your site deploys per project: an SFTP, FTP, or FTPS target on your
            classic web space (e.g. IONOS, Strato, all-inkl, Netcup, Hetzner). Credentials go into
            the system keychain.
          </p>
          <p className="onboarding__text">
            When publishing, Web AI Builder uploads only the changed files and remembers the state —
            so you can roll back to an earlier version in seconds at any time.
          </p>
          <p className="onboarding__note">
            Just create your first project now. Everything else — AI and web space — you handle when
            you need it.
          </p>
        </section>
      );
  }
}
