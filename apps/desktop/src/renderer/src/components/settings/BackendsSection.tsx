/**
 * Sektion „KI & Backends" — DER eine Aktivierungsweg für alle sechs Backends
 * (ersetzt das alte Doppel aus Formular-oben + BackendPicker-unten, das im Code
 * selbst als erklärungsbedürftig markiert war).
 *
 * Jede Karte zeigt Status + kontextuelle Aktion:
 *  - API-Key-Backends (byok, claude-sdk): Inline-Formular in der Karte
 *    (Provider nur bei byok, Modell, Key); Speichern aktiviert das Backend und
 *    legt den Key im OS-Schlüsselbund ab — in einem Schritt.
 *  - Abo-Backends: Erkennungs-Status („eingeloggt als …"), „Verwenden" bzw.
 *    geführter „Einrichten"-Fluss (Hinweis → Bestätigen → Aktivieren, PLAN §3).
 *
 * Compliance: keine Token-/Base-URL-Eingabe; Abo-Backends laufen ausschließlich
 * über die selbst installierte, selbst eingeloggte offizielle Vendor-CLI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BackendId } from '@webaibuilder/core';

import {
  APIKEY_BACKEND_IDS,
  backendBlockReason,
  backendDisplayName,
  backendSelectAction,
  isBackendSelectable,
  isSubscriptionBackend,
  SUBSCRIPTION_BACKEND_IDS,
  subscriptionStatusLabel,
  type ApiKeyBackendId,
  type BackendAvailabilityView,
  type BackendPickerState,
} from '../../../../shared/backends';
import {
  BYOK_PROVIDERS,
  KEYCHAIN_UNAVAILABLE_WARNING,
  type AgentSettings,
  type ByokProvider,
} from '../../../../shared/settings';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { BackendNoticePanel } from './BackendNoticePanel';

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
};

/** Status-Icon eines Abo-Backends (visueller Anker neben dem Text-Label). */
function subscriptionStatusIcon(view: BackendAvailabilityView): {
  name: IconName;
  className: string;
} {
  if (!view.enabled) return { name: 'alert', className: 'status-icon status-icon--warn' };
  if (!view.installed) return { name: 'dot', className: 'status-icon status-icon--muted' };
  if (view.loggedIn === false) return { name: 'alert', className: 'status-icon status-icon--warn' };
  if (view.loggedIn === true) return { name: 'check', className: 'status-icon status-icon--ok' };
  return { name: 'dot', className: 'status-icon status-icon--ok' };
}

interface BackendsSectionProps {
  settings: AgentSettings | null;
  /** Deep-Link: diese Karte aufgeklappt anzeigen und hinscrollen. */
  focusBackendId?: BackendId;
  onSaved: (settings: AgentSettings) => void;
}

export function BackendsSection({
  settings,
  focusBackendId,
  onSaved,
}: BackendsSectionProps): React.JSX.Element {
  const [state, setState] = useState<BackendPickerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState<BackendId | null>(null);
  const [acking, setAcking] = useState(false);
  /** Inline-Rückmeldung pro Backend (Aktivierung, Ablehnung des Main-Prozesses). */
  const [feedback, setFeedback] = useState<Partial<Record<BackendId, string>>>({});
  /** Aufgeklapptes API-Key-Formular (Deep-Link öffnet die Ziel-Karte direkt). */
  const [openForm, setOpenForm] = useState<ApiKeyBackendId | null>(
    focusBackendId !== undefined && !isSubscriptionBackend(focusBackendId)
      ? (focusBackendId as ApiKeyBackendId)
      : null,
  );

  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' });
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    window.wab.backends
      .list()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setError('KI-Backends konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    setFeedback({});
    window.wab.backends
      .refresh()
      .then(setState)
      .catch(() => setError('Neu prüfen fehlgeschlagen.'))
      .finally(() => setRefreshing(false));
  }, []);

  const openHint = useCallback((url: string) => {
    void window.wab.backends.openHint(url).catch(() => undefined);
  }, []);

  /** Setzt ein bereites Abo-Backend als aktives Backend (Main prüft autoritativ). */
  const activate = useCallback(
    async (id: BackendId) => {
      setFeedback((f) => ({ ...f, [id]: 'Aktiviere …' }));
      try {
        const next = await window.wab.settings.set({ backendId: id });
        onSaved(next);
        setFeedback((f) => ({
          ...f,
          [id]: 'Aktiv — der Chat läuft jetzt über deine eigene CLI.',
        }));
      } catch (err) {
        setFeedback((f) => ({
          ...f,
          [id]: err instanceof Error ? err.message : 'Aktivierung fehlgeschlagen.',
        }));
      }
    },
    [onSaved],
  );

  const acknowledge = useCallback(
    (id: BackendId) => {
      setAcking(true);
      window.wab.backends
        .acknowledge(id)
        .then((next) => {
          setState(next);
          setNoticeOpen(null);
          // Geführter Pfad: nach der expliziten Bestätigung direkt aktivieren.
          void activate(id);
        })
        .catch(() => setError('Bestätigung fehlgeschlagen.'))
        .finally(() => setAcking(false));
    },
    [activate],
  );

  const views = state?.backends ?? [];
  const viewFor = (id: BackendId): BackendAvailabilityView | undefined =>
    views.find((v) => v.backendId === id);
  const activeBackendId = settings?.backendId ?? null;

  return (
    <section className="backends" aria-label="KI & Backends">
      <div className="backends__head">
        <p className="backends__group-hint">
          Wähle, worüber der KI-Chat läuft: dein eigener API-Key oder dein Abo über die offizielle
          Anbieter-CLI.
        </p>
        <button
          type="button"
          className="btn backends__refresh"
          onClick={refresh}
          disabled={loading || refreshing}
        >
          {refreshing ? 'Prüfe …' : 'Neu prüfen'}
        </button>
      </div>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="backends__group">
        <p className="backends__group-title">Per API-Key</p>
        <ul className="backends__list">
          {APIKEY_BACKEND_IDS.map((id) => (
            <ApiKeyCard
              key={id}
              id={id}
              settings={settings}
              active={id === activeBackendId}
              expanded={openForm === id}
              onToggle={() => setOpenForm((current) => (current === id ? null : id))}
              onSaved={onSaved}
              cardRef={focusBackendId === id ? focusRef : undefined}
            />
          ))}
        </ul>
      </div>

      <div className="backends__group">
        <p className="backends__group-title">Per Abo</p>
        <p className="backends__group-hint">
          Nutzt dein eigenes Abo über die offizielle CLI des Anbieters, die du selbst installierst
          und in die du dich selbst einloggst. Diese App speichert keine Zugangs-Token.
        </p>
        {loading ? (
          <p className="backends__loading">Erkenne installierte CLIs …</p>
        ) : (
          <ul className="backends__list">
            {SUBSCRIPTION_BACKEND_IDS.map((id) => {
              const view = viewFor(id);
              if (view === undefined) return null;
              return (
                <SubscriptionCard
                  key={id}
                  view={view}
                  active={view.backendId === activeBackendId}
                  feedback={feedback[id]}
                  onOpenHint={openHint}
                  onOpenNotice={() => setNoticeOpen(id)}
                  cardRef={focusBackendId === id ? focusRef : undefined}
                  onSelect={() => {
                    const action = backendSelectAction(view);
                    if (action.kind === 'acknowledge') {
                      setNoticeOpen(id);
                      return;
                    }
                    if (action.kind === 'activate') {
                      void activate(id);
                      return;
                    }
                    if (action.hintUrl !== undefined) openHint(action.hintUrl);
                    setFeedback((f) => ({ ...f, [id]: action.message }));
                  }}
                />
              );
            })}
          </ul>
        )}
      </div>

      {noticeOpen !== null && (
        <BackendNoticePanel
          backendId={noticeOpen}
          busy={acking}
          onOpenHint={openHint}
          onConfirm={() => acknowledge(noticeOpen)}
          onCancel={() => setNoticeOpen(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* API-Key-Karte mit Inline-Formular                                   */
/* ------------------------------------------------------------------ */

function apiKeyStatusLabel(active: boolean, settings: AgentSettings | null): string {
  if (!active || settings === null) return 'nicht aktiv';
  if (!settings.hasApiKey) return 'aktiv · kein Key';
  return settings.apiKeySource === 'env'
    ? 'aktiv · Key aus Umgebungsvariable'
    : 'aktiv · Key gesetzt';
}

function ApiKeyCard({
  id,
  settings,
  active,
  expanded,
  onToggle,
  onSaved,
  cardRef,
}: {
  id: ApiKeyBackendId;
  settings: AgentSettings | null;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: (settings: AgentSettings) => void;
  cardRef?: React.RefObject<HTMLLIElement | null>;
}): React.JSX.Element {
  const [provider, setProvider] = useState<ByokProvider>(
    active && settings !== null ? settings.provider : 'anthropic',
  );
  const [model, setModel] = useState(active && settings !== null ? settings.model : '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const keychainAvailable = settings?.keychainAvailable ?? true;
  const hasKeychainKey = active && settings?.hasApiKey === true && settings.apiKeySource === 'keychain';

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Speichern + aktivieren in EINEM Schritt (vorher zwei getrennte Wege).
      const next = await window.wab.settings.set({
        backendId: id,
        ...(id === 'byok' ? { provider } : {}),
        model,
        // Leerer Key = unverändert lassen; getippter Key wird gesetzt.
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
      onSaved(next);
      setSaved(true);
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
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="backend-row backend-row--card" ref={cardRef}>
      <div className="backend-row__main">
        <span className="backend-row__name">{backendDisplayName(id)}</span>
        <span className="backend-row__status">
          <Icon
            name={active ? (settings?.hasApiKey === true ? 'check' : 'alert') : 'dot'}
            size={12}
            className={
              active
                ? settings?.hasApiKey === true
                  ? 'status-icon status-icon--ok'
                  : 'status-icon status-icon--warn'
                : 'status-icon status-icon--muted'
            }
          />
          {apiKeyStatusLabel(active, settings)}
        </span>
      </div>
      <div className="backend-row__actions">
        {active && <span className="backend-pill">aktiv</span>}
        <button type="button" className="btn backend-row__btn" onClick={onToggle}>
          {expanded ? 'Zuklappen' : active ? 'Bearbeiten' : 'Einrichten'}
        </button>
      </div>

      {expanded && (
        <form
          className="backend-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {id === 'byok' && (
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
              placeholder="z. B. claude-opus-4-8"
              onChange={(e) => setModel(e.target.value)}
            />
            <span className="field__hint">Leer lassen für das Standardmodell.</span>
          </label>

          {!keychainAvailable && (
            <p className="form-warning" role="status">
              {KEYCHAIN_UNAVAILABLE_WARNING}
            </p>
          )}

          <label className="field">
            <span className="field__label">
              API-Key{' '}
              {active && settings?.hasApiKey === true && (
                <span className="field__badge">
                  {settings.apiKeySource === 'env' ? 'aus Umgebung' : 'gesetzt'}
                </span>
              )}
            </span>
            <input
              className="field__input"
              type="password"
              value={apiKey}
              placeholder={hasKeychainKey ? '•••••••• (unverändert lassen)' : 'API-Key eingeben'}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <span className="field__hint">
              {keychainAvailable
                ? 'Der Key liegt im Systemschlüsselbund, nie im Klartext auf der Platte, und wird nie an die Oberfläche zurückgegeben.'
                : 'Ohne Systemschlüsselbund bleibt der Key nur für diese Sitzung im Speicher.'}
            </span>
          </label>

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="backend-row__note" role="status">
              Gespeichert — dieses Backend ist jetzt aktiv.
            </p>
          )}

          <div className="backend-form__actions">
            {hasKeychainKey && (
              <button type="button" className="btn" disabled={busy} onClick={() => void clearKey()}>
                Key entfernen
              </button>
            )}
            <span className="modal__actions-spacer" />
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Speichere …' : active ? 'Speichern' : 'Speichern & aktivieren'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Abo-Karte (Erkennung + geführte Aktivierung)                        */
/* ------------------------------------------------------------------ */

function SubscriptionCard({
  view,
  active,
  feedback,
  onOpenHint,
  onOpenNotice,
  onSelect,
  cardRef,
}: {
  view: BackendAvailabilityView;
  active: boolean;
  feedback?: string;
  onOpenHint: (url: string) => void;
  onOpenNotice: () => void;
  onSelect: () => void;
  cardRef?: React.RefObject<HTMLLIElement | null>;
}): React.JSX.Element {
  const reason = backendBlockReason(view);
  const selectable = isBackendSelectable(view);
  const statusClass = view.enabled
    ? 'backend-row__status'
    : 'backend-row__status backend-row__status--off';

  return (
    <li
      className={view.enabled ? 'backend-row' : 'backend-row backend-row--disabled'}
      ref={cardRef}
    >
      <div className="backend-row__main">
        <span className="backend-row__name">
          {backendDisplayName(view.backendId)}
          {view.experimental && <span className="backend-tag">experimentell</span>}
        </span>
        <span className={statusClass}>
          <Icon
            name={subscriptionStatusIcon(view).name}
            size={12}
            className={subscriptionStatusIcon(view).className}
          />
          {active ? `aktiv · ${subscriptionStatusLabel(view)}` : subscriptionStatusLabel(view)}
        </span>
      </div>

      <div className="backend-row__actions">
        {active ? (
          <span className="backend-pill">aktiv</span>
        ) : selectable ? (
          <button type="button" className="btn backend-row__btn" onClick={onSelect}>
            Verwenden
          </button>
        ) : reason === 'needs-ack' ? (
          <button type="button" className="btn backend-row__btn" onClick={onOpenNotice}>
            Einrichten
          </button>
        ) : reason === 'kill-switch' ? null : (
          <button type="button" className="btn backend-row__btn" onClick={onSelect}>
            {reason === 'not-logged-in' ? 'Anmelden' : 'Installieren'}
          </button>
        )}
      </div>

      {(view.disabledReason !== undefined ||
        view.noticeMarkdown !== undefined ||
        view.installHintUrl !== undefined ||
        feedback !== undefined) && (
        <div className="backend-row__foot">
          {view.disabledReason !== undefined && (
            <p className="backend-row__reason">{view.disabledReason}</p>
          )}
          {view.noticeMarkdown !== undefined && (
            <p className="backend-row__note">{view.noticeMarkdown}</p>
          )}
          {feedback !== undefined && feedback !== '' && (
            <p className="backend-row__note">{feedback}</p>
          )}
          {view.installHintUrl !== undefined && (
            <button
              type="button"
              className="backend-link"
              onClick={() => onOpenHint(view.installHintUrl as string)}
            >
              {reason === 'not-logged-in' ? 'Anmeldung öffnen' : 'Installationsanleitung öffnen'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
