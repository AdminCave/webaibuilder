import { useState } from 'react';

interface ChatMessage {
  id: number;
  text: string;
}

export function ChatPanel(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  function send(): void {
    const text = draft.trim();
    if (text === '') return;
    setMessages((prev) => [...prev, { id: Date.now(), text }]);
    setDraft('');
  }

  return (
    <section className="panel panel--chat" aria-label="Chat">
      <header className="panel__header">
        <h1 className="panel__title">Chat</h1>
        <span className="chip">kein Backend</span>
      </header>

      <div className="chat__messages">
        {messages.length === 0 ? (
          <div className="chat__empty">
            <h2>Was willst du bauen?</h2>
            <p>
              Beschreib deine Webseite — die KI erstellt sie Schritt für Schritt und du siehst
              rechts sofort die Vorschau.
            </p>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} className="msg msg--user">
                {m.text}
              </div>
            ))}
            <div className="msg msg--note">
              Noch kein KI-Backend verbunden — der Chat wird in M2 aktiviert.
            </div>
          </>
        )}
      </div>

      <footer className="chat__composer">
        <textarea
          className="chat__input"
          rows={2}
          placeholder="Beschreibe deine Webseite …"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="btn btn--primary" onClick={send} disabled={draft.trim() === ''}>
          Senden
        </button>
      </footer>
    </section>
  );
}
