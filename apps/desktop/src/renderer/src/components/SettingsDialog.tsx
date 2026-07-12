import { useState } from 'react';

import {
  ACTIVE_BACKEND_IDS,
  BYOK_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  type ActiveBackendId,
  type AgentSettings,
  type ByokProvider,
} from '../../../shared/settings';

interface SettingsDialogProps {
  initial: AgentSettings | null;
  onClose: () => void;
  onSaved: (settings: AgentSettings) => void;
}

const BACKEND_LABEL: Record<ActiveBackendId, string> = {
  byok: 'Eigener API-Key (byok)',
  'claude-sdk': 'Claude (Agent-SDK, API-Key)',
};

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
};

/**
 * Minimale Einstellungen (PLAN §6, M2): aktives Backend, für byok zusätzlich
 * Provider + Modell, sowie der API-Key. Der Key wird nur für die laufende
 * Sitzung im Main-Prozess gehalten (nicht auf die Platte geschrieben) — Hinweis
 * unten. Deutsche Copy, Du-Form.
 */
export function SettingsDialog({ initial, onClose, onSaved }: SettingsDialogProps): React.JSX.Element {
  const base = initial ?? { ...DEFAULT_AGENT_SETTINGS, hasApiKey: false };
  const [backendId, setBackendId] = useState<ActiveBackendId>(base.backendId);
  const [provider, setProvider] = useState<ByokProvider>(base.provider);
  const [model, setModel] = useState(base.model);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(base.hasApiKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await window.wab.settings.set({
        backendId,
        provider,
        model,
        // Leerer Key = unverändert lassen; getippter Key wird gesetzt.
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      });
      onSaved(next);
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
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Einstellungen">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
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
            <span className="field__label">KI-Backend</span>
            <select
              className="field__input"
              value={backendId}
              onChange={(e) => setBackendId(e.target.value as ActiveBackendId)}
            >
              {ACTIVE_BACKEND_IDS.map((id) => (
                <option key={id} value={id}>
                  {BACKEND_LABEL[id]}
                </option>
              ))}
            </select>
          </label>

          {backendId === 'byok' && (
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
              placeholder={backendId === 'claude-sdk' ? 'claude-opus-4-8' : 'z. B. claude-opus-4-8'}
              onChange={(e) => setModel(e.target.value)}
            />
            <span className="field__hint">Leer lassen für das Standardmodell des Backends.</span>
          </label>

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
              Der Key bleibt nur für diese Sitzung im Speicher und wird nicht auf die Platte
              geschrieben. Beim nächsten Start musst du ihn erneut eingeben.
            </span>
          </label>

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
