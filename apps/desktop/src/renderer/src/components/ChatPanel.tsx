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
  /** Öffnet die Einstellungen an einer bestimmten Stelle (Deep-Link). */
  onOpenSettings: (route: SettingsRoute) => void;
  /** Meldet frisch gespeicherte Einstellungen an die App (schaltet den Chat frei). */
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

  // Für API-Key-Backends spiegelt `backendReady` den hinterlegten Key; Abo-/CLI-
  // Backends sind ohne Key bereit (Login liegt bei der eigenen CLI).
  const chipLabel =
    backendId === null ? 'kein Backend' : activeBackendStatusLabel(backendId, backendReady);

  return (
    <section className="panel panel--chat" aria-label="Chat">
      <header className="panel__header">
        <h1 className="panel__title">Chat</h1>
        <span className="chip">{chipLabel}</span>
      </header>

      <div className="chat__messages" ref={messagesRef}>
        {chat.messages.length === 0 ? (
          <div className="chat__empty">
            <h2>Was willst du bauen?</h2>
            <p>
              Beschreib deine Webseite — die KI erstellt sie Schritt für Schritt und du siehst
              rechts sofort die Vorschau.
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
            <p className="chat__error-title">Fehler in der Vorschau</p>
            <p className="chat__error-message">{pageError.message}</p>
          </div>
          <div className="chat__error-actions">
            <button type="button" className="btn btn--primary" onClick={onFixError} disabled={running}>
              Fehler beheben
            </button>
            <button type="button" className="btn" onClick={onDismissError}>
              Verwerfen
            </button>
          </div>
        </div>
      )}

      <footer className="chat__composer">
        <textarea
          className="chat__input"
          rows={2}
          placeholder={backendReady ? 'Beschreibe deine Webseite …' : 'Erst ein Backend einrichten …'}
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
            Stopp
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={draft.trim() === '' || !backendReady}
          >
            <Icon name="send" size={14} />
            Senden
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
        <p className="msg__thinking">Die KI arbeitet …</p>
      ) : (
        message.text !== '' && <div className="msg__text">{message.text}</div>
      )}

      {message.status === 'error' && <ErrorDetails message={message} />}
      {message.status === 'interrupted' && !running && (
        <p className="msg__note">Abgebrochen.</p>
      )}
      {typeof message.costUsd === 'number' && (
        <p className="msg__cost">{formatCost(message.costUsd)}</p>
      )}
    </div>
  );
}

/**
 * Geführter Einrichtungs-Pfad im leeren Chat (statt totem Disabled-Zustand):
 * empfiehlt das erste nutzbare Abo-Backend („gefunden — jetzt einrichten",
 * inkl. Hinweis-Bestätigung, Compliance PLAN §3) oder führt zum API-Key in den
 * Einstellungen. Genau die Lücke, die vorher „erkennt Claude, aber man kann
 * nichts machen" erzeugte.
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
        // Erkennung nicht verfügbar → auf den API-Key-Pfad zurückfallen.
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
      // Compliance: erst die explizite Bestätigung persistieren, DANN aktivieren —
      // der Main-Prozess prüft die Aktivierung autoritativ (applySettingsUpdate).
      if (withAck) await window.wab.backends.acknowledge(id);
      const next = await window.wab.settings.set({ backendId: id });
      onSettingsSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktivierung fehlgeschlagen.');
    } finally {
      setBusy(false);
      setNoticeBackend(null);
    }
  }

  if (views === null) {
    return <p className="chat__hint">Prüfe verfügbare KI-Backends …</p>;
  }
  const cta = recommendChatSetup(views);

  return (
    <div className="chat__setup">
      {cta.kind === 'use-subscription' ? (
        <>
          <p className="chat__hint">
            {backendDisplayName(cta.backendId)} ist auf deinem Rechner installiert — du kannst den
            Chat direkt über dein Abo nutzen.
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
                ? 'Aktiviere …'
                : `${backendDisplayName(cta.backendId)} ${cta.needsAck ? 'jetzt einrichten' : 'verwenden'}`}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onOpenSettings({ section: 'backends' })}
            >
              Andere Backends
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="chat__hint">
            Hinterleg zuerst ein KI-Backend samt API-Key — oder installiere eine der
            unterstützten Anbieter-CLIs für den Abo-Modus.
          </p>
          <div className="chat__setup-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onOpenSettings({ section: 'backends', backendId: 'byok' })}
            >
              <Icon name="key" size={14} />
              API-Key hinterlegen
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
 * Fehleranzeige einer Assistant-Bubble: Meldung, dazu (falls erkannt) ein
 * handlungsleitender Hinweis und die aufklappbare technische Ursache — vorher
 * ging die echte Ursache (401, ungültiges Modell, …) verloren.
 */
function ErrorDetails({ message }: { message: AssistantMessage }): React.JSX.Element {
  const hint = humanizeAgentError(`${message.errorText ?? ''}\n${message.errorCause ?? ''}`);
  return (
    <div className="msg__error-block">
      <p className="msg__error">
        <Icon name="alert" size={14} />
        {message.errorText ?? 'Es ist ein Fehler aufgetreten.'}
      </p>
      {hint !== null && <p className="msg__error-hint">{hint}</p>}
      {message.errorCause !== undefined && message.errorCause !== '' && (
        <details className="msg__error-details">
          <summary>Details anzeigen</summary>
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
    <div className="permission" role="alertdialog" aria-label="Erlaubnis erforderlich">
      <p className="permission__scope">{scopeLabel(permission.scope)}</p>
      <p className="permission__desc">{permission.description}</p>
      <div className="permission__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onPermission(permission.requestId, true)}
        >
          Erlauben
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onPermission(permission.requestId, false)}
        >
          Ablehnen
        </button>
      </div>
    </div>
  );
}

function scopeLabel(scope: PendingPermission['scope']): string {
  switch (scope) {
    case 'edit-in-site':
      return 'Datei in site/ ändern';
    case 'edit-outside-site':
      return 'Datei außerhalb von site/ ändern';
    case 'shell':
      return 'Befehl ausführen';
    case 'network':
      return 'Netzwerkzugriff';
    default:
      return 'Aktion';
  }
}

function formatCost(costUsd: number): string {
  return `${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)} $`;
}
