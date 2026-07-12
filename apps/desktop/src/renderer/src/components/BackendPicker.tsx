import { useCallback, useEffect, useState } from 'react';

import type { BackendId } from '@webaibuilder/core';

import {
  APIKEY_BACKEND_IDS,
  backendBlockReason,
  backendDisplayName,
  backendSelectAction,
  isBackendSelectable,
  noticeFor,
  SUBSCRIPTION_BACKEND_IDS,
  subscriptionStatusLabel,
  type BackendAvailabilityView,
  type BackendPickerState,
} from '../../../shared/backends';

interface BackendPickerProps {
  /** Aktuell aktives (turn-treibendes) Backend aus den Einstellungen. */
  activeBackendId: BackendId;
  /** Hat das aktive API-Key-Backend einen hinterlegten Key? */
  activeHasApiKey: boolean;
  /**
   * Setzt ein bereites Abo-Backend als aktives Backend (`settings.set`). Wirft
   * mit deutscher Meldung, wenn der Main-Prozess die Aktivierung ablehnt.
   */
  onActivate: (id: BackendId) => Promise<void>;
}

/**
 * „KI-Backends"-Statusbereich (PLAN §3/§4, M4). Zeigt alle sechs Backends,
 * gruppiert in „Per Abo" (offizielle Vendor-CLI des Nutzers) und „Per API-Key".
 * Für Abo-Backends: Erkennung (installiert? eingeloggt?), Kill-Switch-Grund,
 * Onboarding-Link, „experimentell"-Tag und der einmalig zu bestätigende
 * Claude-Abo-Hinweis. Detection wird gecacht; „neu prüfen" probt neu.
 *
 * Compliance: Es gibt hier bewusst KEINE Token-/Base-URL-Eingabe. Abo-Backends
 * laufen ausschließlich über die selbst installierte, selbst eingeloggte CLI.
 */
export function BackendPicker({
  activeBackendId,
  activeHasApiKey,
  onActivate,
}: BackendPickerProps): React.JSX.Element {
  const [state, setState] = useState<BackendPickerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Backend, dessen Hinweis-Dialog gerade offen ist (oder null). */
  const [noticeOpen, setNoticeOpen] = useState<BackendId | null>(null);
  const [acking, setAcking] = useState(false);
  /** Inline-Rückmeldung pro Backend (z. B. „bereit" nach Auswahl). */
  const [feedback, setFeedback] = useState<Partial<Record<BackendId, string>>>({});

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

  const acknowledge = useCallback((id: BackendId) => {
    setAcking(true);
    window.wab.backends
      .acknowledge(id)
      .then((next) => {
        setState(next);
        setNoticeOpen(null);
      })
      .catch(() => setError('Bestätigung fehlgeschlagen.'))
      .finally(() => setAcking(false));
  }, []);

  /** Setzt ein bereites Abo-Backend als aktives Backend (persistiert über Main). */
  const activate = useCallback(
    async (id: BackendId) => {
      setFeedback((f) => ({ ...f, [id]: 'Aktiviere …' }));
      try {
        await onActivate(id);
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
    [onActivate],
  );

  const views = state?.backends ?? [];
  const viewFor = (id: BackendId): BackendAvailabilityView | undefined =>
    views.find((v) => v.backendId === id);

  return (
    <section className="backends" aria-label="KI-Backends">
      <div className="backends__head">
        <h3 className="backends__title">KI-Backends</h3>
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

      {loading ? (
        <p className="backends__loading">Erkenne installierte CLIs …</p>
      ) : (
        <>
          <div className="backends__group">
            <p className="backends__group-title">Per Abo</p>
            <p className="backends__group-hint">
              Nutzt dein eigenes Abo über die offizielle CLI des Anbieters, die du selbst
              installierst und in die du dich selbst einloggst. Diese App speichert keine
              Zugangs-Token.
            </p>
            <ul className="backends__list">
              {SUBSCRIPTION_BACKEND_IDS.map((id) => {
                const view = viewFor(id);
                if (view === undefined) return null;
                return (
                  <SubscriptionRow
                    key={id}
                    view={view}
                    active={view.backendId === activeBackendId}
                    feedback={feedback[id]}
                    onOpenHint={openHint}
                    onOpenNotice={() => setNoticeOpen(id)}
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
          </div>

          <div className="backends__group">
            <p className="backends__group-title">Per API-Key</p>
            <ul className="backends__list">
              {APIKEY_BACKEND_IDS.map((id) => (
                <li key={id} className="backend-row">
                  <div className="backend-row__main">
                    <span className="backend-row__name">{backendDisplayName(id)}</span>
                    <span className="backend-row__status">
                      {id === activeBackendId
                        ? activeHasApiKey
                          ? 'aktiv · Key gesetzt'
                          : 'aktiv · kein Key'
                        : 'oben konfigurierbar'}
                    </span>
                  </div>
                  {id === activeBackendId && <span className="backend-pill">aktiv</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {noticeOpen !== null && (
        <NoticePanel
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

function SubscriptionRow({
  view,
  active,
  feedback,
  onOpenHint,
  onOpenNotice,
  onSelect,
}: {
  view: BackendAvailabilityView;
  active: boolean;
  feedback?: string;
  onOpenHint: (url: string) => void;
  onOpenNotice: () => void;
  onSelect: () => void;
}): React.JSX.Element {
  const reason = backendBlockReason(view);
  const selectable = isBackendSelectable(view);
  const statusClass = view.enabled ? 'backend-row__status' : 'backend-row__status backend-row__status--off';

  return (
    <li className={view.enabled ? 'backend-row' : 'backend-row backend-row--disabled'}>
      <div className="backend-row__main">
        <span className="backend-row__name">
          {backendDisplayName(view.backendId)}
          {view.experimental && <span className="backend-tag">experimentell</span>}
        </span>
        <span className={statusClass}>
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
            Hinweis lesen
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

function NoticePanel({
  backendId,
  busy,
  onOpenHint,
  onConfirm,
  onCancel,
}: {
  backendId: BackendId;
  busy: boolean;
  onOpenHint: (url: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element | null {
  const notice = noticeFor(backendId);
  if (notice === null) return null;

  return (
    <div className="backend-notice" role="group" aria-label={notice.title}>
      <p className="backend-notice__title">{notice.title}</p>
      {notice.paragraphs.map((paragraph, index) => (
        <p key={index} className="backend-notice__text">
          {paragraph}
        </p>
      ))}
      <button type="button" className="backend-link" onClick={() => onOpenHint(notice.termsUrl)}>
        {notice.termsLabel}
      </button>
      <div className="backend-notice__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Speichere …' : 'Verstanden und bestätigen'}
        </button>
      </div>
    </div>
  );
}
