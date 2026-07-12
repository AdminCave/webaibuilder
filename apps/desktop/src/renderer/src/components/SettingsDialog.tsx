import { useEffect, useState } from 'react';

import type { BackendId } from '@webaibuilder/core';

import {
  APIKEY_BACKEND_IDS,
  isSubscriptionBackend,
  type ApiKeyBackendId,
} from '../../../shared/backends';
import {
  BYOK_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  KEYCHAIN_UNAVAILABLE_WARNING,
  type AgentSettings,
  type ByokProvider,
} from '../../../shared/settings';
import { BackendPicker } from './BackendPicker';

interface SettingsDialogProps {
  initial: AgentSettings | null;
  onClose: () => void;
  onSaved: (settings: AgentSettings) => void;
  /** Startet den Einführungs-Flow erneut (schließt den Dialog). */
  onReplayOnboarding: () => void;
}

/** Anzahl Log-Zeilen, die „Logs kopieren" in die Zwischenablage legt. */
const LOG_TAIL_LINES = 500;

const BACKEND_LABEL: Record<ApiKeyBackendId, string> = {
  byok: 'Eigener API-Key (byok)',
  'claude-sdk': 'Claude (Agent-SDK, API-Key)',
};

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
};

/** Nur API-Key-Backends können im Formular oben konfiguriert werden. */
function initialKeyBackend(active: BackendId): ApiKeyBackendId {
  return isSubscriptionBackend(active) ? 'byok' : active;
}

/**
 * Einstellungen (PLAN §6): aktives Backend + Schlüssel/Modell.
 *
 * Zwei Aktivierungswege:
 *  - API-Key-Backends (byok/claude-sdk) werden oben konfiguriert (Provider,
 *    Modell, Key) und mit „Speichern" aktiviert. Der Key liegt im OS-Schlüsselbund
 *    (M3, secrets.ts) — der Renderer setzt/löscht ihn nur, bekommt ihn nie zurück.
 *  - Abo-Backends (claude-cli/codex/gemini-cli/grok-cli) werden unten unter
 *    „KI-Backends" ausgewählt; „Verwenden" setzt sie sofort als aktives Backend
 *    (der Main-Prozess prüft installiert/eingeloggt/Kill-Switch/Hinweis). Sie
 *    brauchen KEINEN Key — der Login liegt bei der eigenen CLI (PLAN §3).
 *
 * Deutsche Copy, Du-Form.
 */
export function SettingsDialog({
  initial,
  onClose,
  onSaved,
  onReplayOnboarding,
}: SettingsDialogProps): React.JSX.Element {
  const base = initial ?? { ...DEFAULT_AGENT_SETTINGS, hasApiKey: false, keychainAvailable: true };
  // Aktuell aktives (turn-treibendes) Backend — jedes der sechs. Wird bei jeder
  // erfolgreichen Aktivierung aus der Server-Antwort aktualisiert.
  const [active, setActive] = useState<AgentSettings>(base);
  // Formular für das oben konfigurierbare API-Key-Backend.
  const [keyBackend, setKeyBackend] = useState<ApiKeyBackendId>(initialKeyBackend(base.backendId));
  const [provider, setProvider] = useState<ByokProvider>(base.provider);
  const [model, setModel] = useState(base.model);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(base.hasApiKey);
  const [keychainAvailable, setKeychainAvailable] = useState(base.keychainAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function adopt(next: AgentSettings): void {
    setActive(next);
    setKeychainAvailable(next.keychainAvailable);
    onSaved(next);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await window.wab.settings.set({
        backendId: keyBackend,
        provider,
        model,
        // Leerer Key = unverändert lassen; getippter Key wird gesetzt.
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      });
      setHasApiKey(next.hasApiKey);
      adopt(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await window.wab.settings.set({ apiKey: null });
      setApiKey('');
      setHasApiKey(next.hasApiKey);
      adopt(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Aktiviert ein bereites Abo-Backend als aktives Backend. Wirft mit deutscher
   * Meldung, wenn der Main-Prozess die Aktivierung ablehnt (nicht bereit) — der
   * Picker zeigt die Meldung dann an der Zeile an. Der Dialog bleibt offen, damit
   * die Auswahl als „aktiv" sichtbar wird.
   */
  async function activateSubscription(id: BackendId): Promise<void> {
    const next = await window.wab.settings.set({ backendId: id });
    adopt(next);
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Einstellungen">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <h2 className="modal__title">Einstellungen</h2>
        </header>

        <form
          className="modal__body"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span className="field__label">Backend mit API-Key</span>
            <select
              className="field__input"
              value={keyBackend}
              onChange={(e) => setKeyBackend(e.target.value as ApiKeyBackendId)}
            >
              {APIKEY_BACKEND_IDS.map((id) => (
                <option key={id} value={id}>
                  {BACKEND_LABEL[id]}
                </option>
              ))}
            </select>
            <span className="field__hint">
              „Speichern" macht dieses API-Key-Backend zum aktiven. Abo-Backends laufen über deine
              eigene CLI — Status und Auswahl unten unter „KI-Backends".
            </span>
          </label>

          {keyBackend === 'byok' && (
            <label className="field">
              <span className="field__label">Provider</span>
              <select
                className="field__input"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ByokProvider)}
              >
                {BYOK_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span className="field__label">Modell</span>
            <input
              className="field__input"
              type="text"
              value={model}
              placeholder={keyBackend === 'claude-sdk' ? 'claude-opus-4-8' : 'z. B. claude-opus-4-8'}
              onChange={(e) => setModel(e.target.value)}
            />
            <span className="field__hint">Leer lassen für das Standardmodell des Backends.</span>
          </label>

          {!keychainAvailable && (
            <p className="form-warning" role="status">
              {KEYCHAIN_UNAVAILABLE_WARNING}
            </p>
          )}

          <label className="field">
            <span className="field__label">
              API-Key {hasApiKey && <span className="field__badge">gesetzt</span>}
            </span>
            <input
              className="field__input"
              type="password"
              value={apiKey}
              placeholder={hasApiKey ? '•••••••• (unverändert lassen)' : 'API-Key eingeben'}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <span className="field__hint">
              {keychainAvailable
                ? 'Der Key liegt im Systemschlüsselbund deines Betriebssystems, nie im Klartext auf der Platte, und bleibt über Neustarts erhalten. Er wird nie an die Oberfläche zurückgegeben.'
                : 'Ohne Systemschlüsselbund bleibt der Key nur für diese Sitzung im Speicher. Beim nächsten Start musst du ihn erneut eingeben.'}
            </span>
          </label>

          <BackendPicker
            activeBackendId={active.backendId}
            activeHasApiKey={active.hasApiKey}
            onActivate={activateSubscription}
          />

          <HelpLogsSection onReplayOnboarding={onReplayOnboarding} />

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal__actions">
            {hasApiKey && (
              <button type="button" className="btn" disabled={busy} onClick={() => void clearKey()}>
                Key entfernen
              </button>
            )}
            <span className="modal__actions-spacer" />
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Kopiert Text möglichst robust in die Zwischenablage: erst die moderne Async-
 * Clipboard-API, sonst der execCommand-Fallback (funktioniert auch ohne
 * Clipboard-Permission im gehärteten Renderer). Rein renderer-seitig — kein
 * zusätzlicher Main-Prozess-Kanal.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Fällt auf execCommand zurück. */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * „Einführung & Fehlerberichte" (M5): erneut das Onboarding zeigen und der
 * lokale Log-Zugang (Pfad anzeigen, Ordner öffnen, letzte Zeilen kopieren).
 * Alles rein lokal (PLAN §1) — es wird nichts an einen Server gesendet.
 */
function HelpLogsSection({
  onReplayOnboarding,
}: {
  onReplayOnboarding: () => void;
}): React.JSX.Element {
  const [logFile, setLogFile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.wab.logs
      .info()
      .then((info) => {
        if (!cancelled) setLogFile(info.file);
      })
      .catch(() => {
        if (!cancelled) setLogFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyLogs(): Promise<void> {
    setFeedback(null);
    try {
      const { text } = await window.wab.logs.tail(LOG_TAIL_LINES);
      if (text.trim() === '') {
        setFeedback('Es gibt noch keine Log-Einträge.');
        return;
      }
      const ok = await copyToClipboard(text);
      setFeedback(ok ? 'Die letzten Log-Zeilen liegen in der Zwischenablage.' : 'Kopieren fehlgeschlagen.');
    } catch {
      setFeedback('Logs konnten nicht gelesen werden.');
    }
  }

  return (
    <section className="help-logs" aria-label="Einführung & Fehlerberichte">
      <h3 className="help-logs__title">Einführung & Fehlerberichte</h3>

      <div className="help-logs__row">
        <div className="help-logs__text">
          <span className="help-logs__label">Einführung</span>
          <span className="field__hint">Zeigt den Willkommens-Flow erneut.</span>
        </div>
        <button type="button" className="btn help-logs__btn" onClick={onReplayOnboarding}>
          Einführung erneut zeigen
        </button>
      </div>

      <div className="help-logs__row">
        <div className="help-logs__text">
          <span className="help-logs__label">Fehler &amp; Logs</span>
          <span className="field__hint">
            Läuft etwas schief, landen die Details in einem lokalen Log auf deinem Rechner. Es wird
            nichts an einen Server gesendet.
          </span>
          {logFile !== null && <span className="help-logs__path">{logFile}</span>}
        </div>
        <div className="help-logs__actions">
          <button
            type="button"
            className="btn help-logs__btn"
            onClick={() => void window.wab.logs.openFolder().catch(() => undefined)}
          >
            Ordner öffnen
          </button>
          <button type="button" className="btn help-logs__btn" onClick={() => void copyLogs()}>
            Logs kopieren
          </button>
        </div>
      </div>

      {feedback !== null && (
        <p className="help-logs__feedback" role="status">
          {feedback}
        </p>
      )}
    </section>
  );
}
