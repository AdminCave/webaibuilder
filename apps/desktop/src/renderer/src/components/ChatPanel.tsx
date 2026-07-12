import { useEffect, useRef, useState } from 'react';

import type { ActiveBackendId } from '../../../shared/settings';
import type { AssistantMessage, ChatState, PendingPermission } from '../../../shared/chatState';
import type { WabPreviewEvent } from '../../../shared/preview';

type PageError = Extract<WabPreviewEvent, { type: 'page-error' }>;

interface ChatPanelProps {
  chat: ChatState;
  backendReady: boolean;
  backendId: ActiveBackendId | null;
  onSend: (prompt: string) => void;
  onInterrupt: () => void;
  onPermission: (requestId: string, allow: boolean) => void;
  pageError: PageError | null;
  onFixError: () => void;
  onDismissError: () => void;
}

const BACKEND_LABEL: Record<ActiveBackendId, string> = {
  byok: 'Eigener API-Key',
  'claude-sdk': 'Claude (API)',
};

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

  const chipLabel =
    backendId === null ? 'kein Backend' : `${BACKEND_LABEL[backendId]}${backendReady ? '' : ' · kein Key'}`;

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
              <p className="chat__hint">
                Hinterleg zuerst ein KI-Backend samt API-Key unter „Einstellungen".
              </p>
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
            Stopp
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={draft.trim() === '' || !backendReady}
          >
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

      {message.status === 'error' && (
        <p className="msg__error">{message.errorText ?? 'Es ist ein Fehler aufgetreten.'}</p>
      )}
      {message.status === 'interrupted' && !running && (
        <p className="msg__note">Abgebrochen.</p>
      )}
      {typeof message.costUsd === 'number' && (
        <p className="msg__cost">{formatCost(message.costUsd)}</p>
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
