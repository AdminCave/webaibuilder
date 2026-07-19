import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { Checkpoint, Project } from '@webaibuilder/core';

import type { PreviewInfo } from '../../../shared/channels';
import { chatReducer, initialChatState, type ChatState } from '../../../shared/chatState';
import { buildErrorFixPrompt } from '../../../shared/errorPrompt';
import type { WabPreviewEvent } from '../../../shared/preview';

type PageError = Extract<WabPreviewEvent, { type: 'page-error' }>;

type OpenStatus = 'opening' | 'ready' | 'error';

export interface ProjectSession {
  status: OpenStatus;
  openError: string | null;
  preview: PreviewInfo | null;
  chat: ChatState;
  checkpoints: Checkpoint[];
  /** Zuletzt gemeldeter Seiten-Fehler → „Fehler beheben"-Button. */
  pageError: PageError | null;
  restoringId: string | null;
  /** Fehlermeldung des letzten Wiederherstellens (vorher stiller Fehlschlag). */
  restoreError: string | null;

  send(prompt: string): void;
  interrupt(): void;
  respondPermission(requestId: string, allow: boolean): void;
  restore(checkpointId: string): void;
  dismissPageError(): void;
  fixPageError(): void;
  /** Session neu öffnen — Wiederanlauf-Pfad für Preview-Fehler. */
  retry(): void;
}

/** Bridge-Fehler ins lokale Log melden statt still zu verschlucken (best effort). */
function reportBridgeError(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  void window.wab.logs
    .report({
      kind: 'error',
      message: `Bridge-Aufruf ${action} fehlgeschlagen: ${message}`,
      source: 'useProjectSession',
    })
    .catch(() => undefined);
}

/**
 * Kapselt die Sitzung eines geöffneten Projekts: startet die Preview über die
 * Bridge, abonniert Agent-/Preview-/Checkpoint-Events und pflegt den Chat-
 * Zustand über den reinen Reducer. Räumt beim Projektwechsel/Unmount auf.
 */
export function useProjectSession(project: Project): ProjectSession {
  const [chat, dispatch] = useReducer(chatReducer, initialChatState);
  const [status, setStatus] = useState<OpenStatus>('opening');
  const [openError, setOpenError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [pageError, setPageError] = useState<PageError | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  /** Zähler, der die Session neu öffnet (Preview-Fehler → „Erneut versuchen"). */
  const [openNonce, setOpenNonce] = useState(0);

  // Preview-Origin für das Fehler-Templating, ohne den send-Callback neu zu binden.
  const previewOriginRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const projectId = project.id;
    setStatus('opening');
    setOpenError(null);
    setPreview(null);
    setPageError(null);
    setRestoreError(null);
    dispatch({ type: 'reset' });

    window.wab.session
      .open(projectId)
      .then((info) => {
        if (cancelled) return;
        setPreview(info.preview);
        previewOriginRef.current = info.preview.origin;
        setCheckpoints(info.checkpoints);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOpenError(error instanceof Error ? error.message : 'Die Vorschau konnte nicht starten.');
        setStatus('error');
      });

    const offAgent = window.wab.events.onAgentEvent((message) => {
      if (message.projectId !== projectId) return;
      dispatch({ type: 'agent-event', runId: message.runId, event: message.event });
    });
    const offPreview = window.wab.events.onPreviewEvent((message) => {
      if (message.projectId !== projectId) return;
      if (message.event.type === 'page-error') setPageError(message.event);
    });
    const offCheckpoints = window.wab.events.onCheckpoints((message) => {
      if (message.projectId !== projectId) return;
      setCheckpoints(message.checkpoints);
    });

    return () => {
      cancelled = true;
      offAgent();
      offPreview();
      offCheckpoints();
      void window.wab.session.close().catch(() => undefined);
    };
  }, [project.id, openNonce]);

  const retry = useCallback(() => setOpenNonce((n) => n + 1), []);

  const send = useCallback((prompt: string) => {
    const text = prompt.trim();
    if (text === '') return;
    const runId = crypto.randomUUID();
    // Optimistisch anlegen, damit früh eintreffende Events zugeordnet werden.
    dispatch({ type: 'user-send', runId, text });
    setPageError(null);
    window.wab.chat.send(text, runId).catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : 'Senden fehlgeschlagen.';
      dispatch({ type: 'agent-event', runId, event: { type: 'error', message: messageText, recoverable: false } });
      dispatch({
        type: 'agent-event',
        runId,
        event: { type: 'turn-complete', turnId: runId, stopReason: 'error' },
      });
    });
  }, []);

  const interrupt = useCallback(() => {
    void window.wab.chat.interrupt().catch((error: unknown) => {
      reportBridgeError('chat.interrupt', error);
    });
  }, []);

  const respondPermission = useCallback((requestId: string, allow: boolean) => {
    dispatch({ type: 'permission-answered', requestId });
    void window.wab.chat.respondPermission({ requestId, allow }).catch((error: unknown) => {
      reportBridgeError('chat.respondPermission', error);
    });
  }, []);

  const restore = useCallback((checkpointId: string) => {
    setRestoringId(checkpointId);
    setRestoreError(null);
    window.wab.checkpoints
      .restore(checkpointId)
      .catch((error: unknown) => {
        // Vorher stiller Fehlschlag — der Nutzer sah nur, dass „nichts passiert".
        setRestoreError(
          error instanceof Error ? error.message : 'Wiederherstellen fehlgeschlagen.',
        );
      })
      .finally(() => setRestoringId(null));
  }, []);

  const dismissPageError = useCallback(() => setPageError(null), []);

  const fixPageError = useCallback(() => {
    setPageError((current) => {
      if (current !== null) {
        send(buildErrorFixPrompt(current, previewOriginRef.current));
      }
      return null;
    });
  }, [send]);

  return {
    status,
    openError,
    preview,
    chat,
    checkpoints,
    pageError,
    restoringId,
    restoreError,
    send,
    interrupt,
    respondPermission,
    restore,
    dismissPageError,
    fixPageError,
    retry,
  };
}
