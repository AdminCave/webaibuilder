/**
 * Einmaliger Backend-Hinweis (Feature-Flag, PLAN §3) — aus dem BackendPicker
 * extrahiert, damit ihn auch der Chat-Empty-State (geführter Einrichtungs-Pfad)
 * anzeigen kann. Compliance: die Bestätigung ist IMMER ein expliziter, lesbarer
 * Schritt; sie wird nie übersprungen oder vorbelegt.
 */

import type { BackendId } from '@webaibuilder/core';

import { noticeFor } from '../../../../shared/backends';

export function BackendNoticePanel({
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
