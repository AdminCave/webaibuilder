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
  /** Schließt den Flow und merkt sich, dass er gesehen wurde (hasOnboarded=true). */
  onComplete: () => void;
  /** Beendet den Flow und öffnet die Einstellungen (KI-Backends). */
  onOpenSettings: () => void;
}

/**
 * Erst-Start-Onboarding (M5, PLAN §1/§3/§6). Leichter, deutscher Willkommens-Flow
 * mit drei Screens — Willkommen · KI wählen · Webspace — kein Wizard-Framework.
 * Erscheint nur beim ersten Start (App gated über `onboarding.get`), ist jederzeit
 * überspringbar und aus den Einstellungen erneut aufrufbar.
 *
 * Strikt AdminCave-DS: Hairline-Card, eine betonte Aktion pro Screen, Pill-Buttons,
 * Du-Form, keine Emojis, keine Gradients. Der Schritt-Automat kommt aus
 * shared/onboarding.ts (rein, getestet).
 */
export function Onboarding({ onComplete, onOpenSettings }: OnboardingProps): React.JSX.Element {
  const [view, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING_VIEW);
  const step = currentStep(view);
  const last = isLastStep(view);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Einführung">
      <div className="modal__backdrop" />
      <div className="modal__panel modal__panel--wide onboarding">
        <header className="onboarding__head">
          <span className="onboarding__step">
            Schritt {stepNumber(view)} von {ONBOARDING_STEP_COUNT}
          </span>
          <button type="button" className="onboarding__skip" onClick={onComplete}>
            Überspringen
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
            Zurück
          </button>
          <span className="modal__actions-spacer" />
          {last ? (
            <button type="button" className="btn btn--primary" onClick={onComplete}>
              Los geht’s
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: 'next' })}>
              Weiter
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
          <h2 className="onboarding__title">Willkommen bei Web AI Builder</h2>
          <p className="onboarding__lead">Deine Webseite. Deine KI. Dein Webspace.</p>
          <p className="onboarding__text">
            Du baust deine Webseite per KI-Chat, siehst jede Änderung sofort in der Live-Vorschau und
            veröffentlichst sie per Knopfdruck auf deinem eigenen Webspace — mit Rollback, falls etwas
            schiefgeht.
          </p>
          <p className="onboarding__text">
            Alles läuft lokal auf deinem Rechner. Die KI nutzt deine eigenen Abos oder API-Keys, die
            Seite liegt auf deinem eigenen Hosting. Keine Cloud dazwischen, keine Zwischenspeicher.
          </p>
        </section>
      );
    case 'ki':
      return (
        <section className="onboarding__screen">
          <h2 className="onboarding__title">KI wählen</h2>
          <p className="onboarding__text">
            Du hast zwei Wege, und du kannst sie mischen:
          </p>
          <ul className="onboarding__list">
            <li>
              <span className="onboarding__list-title">Eigener API-Key</span> — du hinterlegst einen
              Schlüssel von Anthropic, OpenAI, Google oder xAI. Der Key liegt im Systemschlüsselbund
              deines Betriebssystems, nie im Klartext auf der Platte.
            </li>
            <li>
              <span className="onboarding__list-title">Eigenes Abo per CLI</span> — nutzt dein
              bestehendes Abo (Claude, Codex, Gemini, Grok) über die offizielle CLI des Anbieters, die
              du selbst installierst und in die du dich selbst einloggst.
            </li>
          </ul>
          <p className="onboarding__note">
            Wichtig: Diese App speichert, proxied oder überträgt niemals deine Anbieter-Token. Beim
            Abo-Weg läuft der Login ausschließlich in der eigenen CLI des Anbieters — wir starten nur,
            was du selbst eingerichtet hast.
          </p>
          <div className="onboarding__inline-actions">
            <button type="button" className="btn" onClick={onOpenSettings}>
              KI-Backends öffnen
            </button>
            <span className="onboarding__hint">Du kannst das auch später in den Einstellungen tun.</span>
          </div>
        </section>
      );
    case 'webspace':
      return (
        <section className="onboarding__screen">
          <h2 className="onboarding__title">Veröffentlichen kommt später — pro Projekt</h2>
          <p className="onboarding__text">
            Wohin deine Seite deployt wird, richtest du je Projekt ein: ein SFTP-, FTP- oder
            FTPS-Ziel auf deinem klassischen Webspace (z. B. IONOS, Strato, all-inkl, Netcup,
            Hetzner). Zugangsdaten landen im Systemschlüsselbund.
          </p>
          <p className="onboarding__text">
            Beim Veröffentlichen lädt Web AI Builder nur die geänderten Dateien hoch und merkt sich
            den Stand — so kannst du jederzeit sekundenschnell auf eine frühere Version zurückrollen.
          </p>
          <p className="onboarding__note">
            Leg jetzt einfach dein erstes Projekt an. Alles Weitere — KI und Webspace — erledigst du,
            wenn du es brauchst.
          </p>
        </section>
      );
  }
}
