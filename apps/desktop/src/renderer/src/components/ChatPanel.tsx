import { useEffect, useRef, useState } from 'react';

import type { BackendId } from '@webaibuilder/core';

import {
  activeBackendStatusLabel,
  backendDisplayName,
  recommendChatSetup,
  type BackendAvailabilityView,
  type SubscriptionBackendId,
} from '../../../shared/backends';
import type { AssistantMessage, ChatState, PendingPermission } from '../../../shared/chatState';
import { humanizeAgentError } from '../../../shared/errorHints';
import type { WabPreviewEvent } from '../../../shared/preview';
import type { AgentSettings } from '../../../shared/settings';
import type { SettingsRoute } from '../../../shared/settingsNav';
import { Icon } from './Icon';
import { BackendNoticePanel } from './settings/BackendNoticePanel';

type PageError = Extract<WabPreviewEvent, { type: 'page-error' }>;

interface ChatPanelProps {
  chat: ChatState;
  backendReady: boolean;
  backendId: BackendId | null;
  onSend: (prompt: string) => void;
  onInterrupt: () => void;
  onPermission: (requestId: string, allow: boolean) => void;
  pageError: PageError | null;
  onFixError: () => void;
  onDismissError: () => void;
  /** Opens settings at a specific location (deep link). */
  onOpenSettings: (route: SettingsRoute) => void;
  /** Reports freshly saved settings to the app (unlocks the chat). */
  onSettingsSaved: (settings: AgentSettings) => void;
}

export function ChatPanel({
  chat,
  backendReady,
  backendId,
  onSend,
  onInterrupt,
  onPermission,
  pageError,
  onFixError,
  onDismissError,
  onOpenSettings,
  onSettingsSaved,
}: ChatPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const running = chat.status === 'running';

  useEffect(() => {
    const node = messagesRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [chat.messages, chat.pendingPermission]);

  function submit(): void {
    const text = draft.trim();
    if (text === '' || running || !backendReady) return;
    onSend(text);
    setDraft('');
  }

  // For API-key backends, `backendReady` reflects the stored key; subscription/CLI
  // backends are ready without a key (login lives in the provider's own CLI).
  const chipLabel =
    backendId === null ? 'no backend' : activeBackendStatusLabel(backendId, backendReady);

  return (
    <section className="panel panel--chat" aria-label="Chat">
      <header className="panel__header">
        <h1 className="panel__title">Chat</h1>
        <span className="chip">{chipLabel}</span>
      </header>

      <div className="chat__messages" ref={messagesRef}>
        {chat.messages.length === 0 ? (
          <div className="chat__empty">
            <h2>What do you want to build?</h2>
            <p>
              Describe your website — the AI builds it step by step and you see the preview on the
              right instantly.
            </p>
            {!backendReady && (
              <ChatSetup onOpenSettings={onOpenSettings} onSettingsSaved={onSettingsSaved} />
            )}
          </div>
        ) : (
          chat.messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="msg msg--user">
                {message.text}
              </div>
            ) : (
              <AssistantBubble key={message.id} message={message} running={running} />
            ),
          )
        )}

        {chat.pendingPermission !== null && (
          <PermissionPrompt permission={chat.pendingPermission} onPermission={onPermission} />
        )}
      </div>

      {pageError !== null && (
        <div className="chat__error" role="alert">
          <div className="chat__error-body">
            <p className="chat__error-title">Error in the preview</p>
            <p className="chat__error-message">{pageError.message}</p>
          </div>
          <div className="chat__error-actions">
            <button type="button" className="btn btn--primary" onClick={onFixError} disabled={running}>
              Fix error
            </button>
            <button type="button" className="btn" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <footer className="chat__composer">
        <textarea
          className="chat__input"
          rows={2}
          placeholder={backendReady ? 'Describe your website …' : 'Set up a backend first …'}
          value={draft}
          disabled={!backendReady}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button type="button" className="btn" onClick={onInterrupt}>
            <Icon name="stop" size={14} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={draft.trim() === '' || !backendReady}
          >
            <Icon name="send" size={14} />
            Send
          </button>
        )}
      </footer>
    </section>
  );
}

function AssistantBubble({
  message,
  running,
}: {
  message: AssistantMessage;
  running: boolean;
}): React.JSX.Element {
  const streaming = message.status === 'streaming';
  const showThinking = streaming && message.text === '' && message.tools.length === 0;

  return (
    <div className="msg msg--assistant">
      {message.tools.length > 0 && (
        <div className="tool-chips">
          {message.tools.map((tool) => (
            <span
              key={tool.toolCallId}
              className={tool.done ? 'tool-chip tool-chip--done' : 'tool-chip'}
            >
              {tool.tool}
              {tool.detail !== undefined && tool.detail !== '' ? ` · ${tool.detail}` : ''}
            </span>
          ))}
        </div>
      )}

      {showThinking ? (
        <p className="msg__thinking">The AI is working …</p>
      ) : (
        message.text !== '' && <div className="msg__text">{message.text}</div>
      )}

      {message.status === 'error' && <ErrorDetails message={message} />}
      {message.status === 'interrupted' && !running && (
        <p className="msg__note">Stopped.</p>
      )}
      {typeof message.costUsd === 'number' && (
        <p className="msg__cost">{formatCost(message.costUsd)}</p>
      )}
    </div>
  );
}

/**
 * Guided setup path in the empty chat (instead of a dead disabled state):
 * recommends the first usable subscription backend ("found — set up now",
 * including notice confirmation, compliance PLAN §3) or leads to the API key in
 * settings. Exactly the gap that previously caused "detects Claude, but you
 * can't do anything".
 */
function ChatSetup({
  onOpenSettings,
  onSettingsSaved,
}: {
  onOpenSettings: (route: SettingsRoute) => void;
  onSettingsSaved: (settings: AgentSettings) => void;
}): React.JSX.Element {
  const [views, setViews] = useState<readonly BackendAvailabilityView[] | null>(null);
  const [noticeBackend, setNoticeBackend] = useState<SubscriptionBackendId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.wab.backends
      .list()
      .then((state) => {
        if (!cancelled) setViews(state.backends);
      })
      .catch(() => {
        // Detection unavailable → fall back to the API-key path.
        if (!cancelled) setViews([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function activate(id: BackendId, withAck: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Compliance: persist the explicit confirmation first, THEN activate —
      // the main process validates the activation authoritatively (applySettingsUpdate).
      if (withAck) await window.wab.backends.acknowledge(id);
      const next = await window.wab.settings.set({ backendId: id });
      onSettingsSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setBusy(false);
      setNoticeBackend(null);
    }
  }

  if (views === null) {
    return <p className="chat__hint">Checking available AI backends …</p>;
  }
  const cta = recommendChatSetup(views);

  return (
    <div className="chat__setup">
      {cta.kind === 'use-subscription' ? (
        <>
          <p className="chat__hint">
            {backendDisplayName(cta.backendId)} is installed on your machine — you can use the chat
            directly through your subscription.
          </p>
          <div className="chat__setup-actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => {
                if (cta.needsAck) setNoticeBackend(cta.backendId);
                else void activate(cta.backendId, false);
              }}
            >
              <Icon name="terminal" size={14} />
              {busy
                ? 'Activating …'
                : `${backendDisplayName(cta.backendId)} ${cta.needsAck ? 'set up now' : 'use'}`}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onOpenSettings({ section: 'backends' })}
            >
              Other backends
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="chat__hint">
            Add an AI backend with an API key first — or install one of the supported provider CLIs
            for subscription mode.
          </p>
          <div className="chat__setup-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onOpenSettings({ section: 'backends', backendId: 'byok' })}
            >
              <Icon name="key" size={14} />
              Add an API key
            </button>
          </div>
        </>
      )}

      {error !== null && (
        <p className="msg__error" role="alert">
          {error}
        </p>
      )}

      {noticeBackend !== null && (
        <BackendNoticePanel
          backendId={noticeBackend}
          busy={busy}
          onOpenHint={(url) => void window.wab.backends.openHint(url).catch(() => undefined)}
          onConfirm={() => void activate(noticeBackend, true)}
          onCancel={() => setNoticeBackend(null)}
        />
      )}
    </div>
  );
}

/**
 * Error display of an assistant bubble: the message plus (if detected) an
 * actionable hint and the expandable technical cause — previously the real
 * cause (401, invalid model, …) was lost.
 */
function ErrorDetails({ message }: { message: AssistantMessage }): React.JSX.Element {
  const hint = humanizeAgentError(`${message.errorText ?? ''}\n${message.errorCause ?? ''}`);
  return (
    <div className="msg__error-block">
      <p className="msg__error">
        <Icon name="alert" size={14} />
        {message.errorText ?? 'An error occurred.'}
      </p>
      {hint !== null && <p className="msg__error-hint">{hint}</p>}
      {message.errorCause !== undefined && message.errorCause !== '' && (
        <details className="msg__error-details">
          <summary>Show details</summary>
          <pre>{message.errorCause}</pre>
        </details>
      )}
    </div>
  );
}

function PermissionPrompt({
  permission,
  onPermission,
}: {
  permission: PendingPermission;
  onPermission: (requestId: string, allow: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="permission" role="alertdialog" aria-label="Permission required">
      <p className="permission__scope">{scopeLabel(permission.scope)}</p>
      <p className="permission__desc">{permission.description}</p>
      <div className="permission__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onPermission(permission.requestId, true)}
        >
          Allow
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onPermission(permission.requestId, false)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function scopeLabel(scope: PendingPermission['scope']): string {
  switch (scope) {
    case 'edit-in-site':
      return 'Modify a file in site/';
    case 'edit-outside-site':
      return 'Modify a file outside site/';
    case 'shell':
      return 'Run a command';
    case 'network':
      return 'Network access';
    default:
      return 'Action';
  }
}

function formatCost(costUsd: number): string {
  return `${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)} $`;
}
