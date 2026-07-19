/**
 * "AI & Backends" section — THE one activation path for all six backends
 * (replaces the old pairing of form-on-top + BackendPicker-below, which the
 * code itself flagged as needing explanation).
 *
 * Each card shows status + a contextual action:
 *  - API-key backends (byok, claude-sdk): inline form in the card (provider
 *    only for byok, model, key); saving activates the backend and stores the
 *    key in the OS keychain — in one step.
 *  - Subscription backends: detection status ("logged in as …"), "Use", or a
 *    guided "Set up" flow (notice → confirm → activate, PLAN §3).
 *
 * Compliance: no token/base-URL input; subscription backends run exclusively
 * through the self-installed, self-logged-in official vendor CLI.
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

/** Status icon of a subscription backend (visual anchor next to the text label). */
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
  /** Deep link: show this card expanded and scroll to it. */
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
  /** Inline feedback per backend (activation, rejection by the main process). */
  const [feedback, setFeedback] = useState<Partial<Record<BackendId, string>>>({});
  /** Expanded API-key form (deep link opens the target card directly). */
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
        if (!cancelled) setError('AI backends could not be loaded.');
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
      .catch(() => setError('Recheck failed.'))
      .finally(() => setRefreshing(false));
  }, []);

  const openHint = useCallback((url: string) => {
    void window.wab.backends.openHint(url).catch(() => undefined);
  }, []);

  /** Sets a ready subscription backend as the active backend (main validates authoritatively). */
  const activate = useCallback(
    async (id: BackendId) => {
      setFeedback((f) => ({ ...f, [id]: 'Activating …' }));
      try {
        const next = await window.wab.settings.set({ backendId: id });
        onSaved(next);
        setFeedback((f) => ({
          ...f,
          [id]: 'Active — the chat now runs through your own CLI.',
        }));
      } catch (err) {
        setFeedback((f) => ({
          ...f,
          [id]: err instanceof Error ? err.message : 'Activation failed.',
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
          // Guided path: activate directly after the explicit confirmation.
          void activate(id);
        })
        .catch(() => setError('Confirmation failed.'))
        .finally(() => setAcking(false));
    },
    [activate],
  );

  const views = state?.backends ?? [];
  const viewFor = (id: BackendId): BackendAvailabilityView | undefined =>
    views.find((v) => v.backendId === id);
  const activeBackendId = settings?.backendId ?? null;

  return (
    <section className="backends" aria-label="AI & Backends">
      <div className="backends__head">
        <p className="backends__group-hint">
          Choose what the AI chat runs on: your own API key or your subscription via the official
          provider CLI.
        </p>
        <button
          type="button"
          className="btn backends__refresh"
          onClick={refresh}
          disabled={loading || refreshing}
        >
          {refreshing ? 'Checking …' : 'Recheck'}
        </button>
      </div>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="backends__group">
        <p className="backends__group-title">By API key</p>
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
        <p className="backends__group-title">By subscription</p>
        <p className="backends__group-hint">
          Uses your own subscription through the provider's official CLI, which you install and log
          into yourself. This app stores no access tokens.
        </p>
        {loading ? (
          <p className="backends__loading">Detecting installed CLIs …</p>
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
/* API-key card with inline form                                       */
/* ------------------------------------------------------------------ */

function apiKeyStatusLabel(active: boolean, settings: AgentSettings | null): string {
  if (!active || settings === null) return 'not active';
  if (!settings.hasApiKey) return 'active · no key';
  return settings.apiKeySource === 'env'
    ? 'active · key from environment variable'
    : 'active · key set';
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
      // Save + activate in ONE step (previously two separate paths).
      const next = await window.wab.settings.set({
        backendId: id,
        ...(id === 'byok' ? { provider } : {}),
        model,
        // Empty key = leave unchanged; a typed key gets set.
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
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
      setError(err instanceof Error ? err.message : 'Delete failed.');
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
        {active && <span className="backend-pill">active</span>}
        <button type="button" className="btn backend-row__btn" onClick={onToggle}>
          {expanded ? 'Collapse' : active ? 'Edit' : 'Set up'}
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
            <span className="field__label">Model</span>
            <input
              className="field__input"
              type="text"
              value={model}
              placeholder="e.g. claude-opus-4-8"
              onChange={(e) => setModel(e.target.value)}
            />
            <span className="field__hint">Leave empty for the default model.</span>
          </label>

          {!keychainAvailable && (
            <p className="form-warning" role="status">
              {KEYCHAIN_UNAVAILABLE_WARNING}
            </p>
          )}

          <label className="field">
            <span className="field__label">
              API key{' '}
              {active && settings?.hasApiKey === true && (
                <span className="field__badge">
                  {settings.apiKeySource === 'env' ? 'from environment' : 'set'}
                </span>
              )}
            </span>
            <input
              className="field__input"
              type="password"
              value={apiKey}
              placeholder={hasKeychainKey ? '•••••••• (leave unchanged)' : 'Enter API key'}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <span className="field__hint">
              {keychainAvailable
                ? 'The key is stored in the system keychain, never in plain text on disk, and is never returned to the UI.'
                : 'Without a system keychain, the key stays in memory for this session only.'}
            </span>
          </label>

          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="backend-row__note" role="status">
              Saved — this backend is now active.
            </p>
          )}

          <div className="backend-form__actions">
            {hasKeychainKey && (
              <button type="button" className="btn" disabled={busy} onClick={() => void clearKey()}>
                Remove key
              </button>
            )}
            <span className="modal__actions-spacer" />
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Saving …' : active ? 'Save' : 'Save & activate'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Subscription card (detection + guided activation)                   */
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
          {view.experimental && <span className="backend-tag">experimental</span>}
        </span>
        <span className={statusClass}>
          <Icon
            name={subscriptionStatusIcon(view).name}
            size={12}
            className={subscriptionStatusIcon(view).className}
          />
          {active ? `active · ${subscriptionStatusLabel(view)}` : subscriptionStatusLabel(view)}
        </span>
      </div>

      <div className="backend-row__actions">
        {active ? (
          <span className="backend-pill">active</span>
        ) : selectable ? (
          <button type="button" className="btn backend-row__btn" onClick={onSelect}>
            Use
          </button>
        ) : reason === 'needs-ack' ? (
          <button type="button" className="btn backend-row__btn" onClick={onOpenNotice}>
            Set up
          </button>
        ) : reason === 'kill-switch' ? null : (
          <button type="button" className="btn backend-row__btn" onClick={onSelect}>
            {reason === 'not-logged-in' ? 'Sign in' : 'Install'}
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
              {reason === 'not-logged-in' ? 'Open sign-in' : 'Open install guide'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
