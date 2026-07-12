/**
 * Commit-Message-Format der Checkpoints (PLAN §4):
 * Subject = erste Prompt-Zeile; Turn-Metadaten als git-Trailer im Body.
 * Format hin (buildCommitMessage) und zurück (parseCheckpoint).
 */

import type { BackendId, Checkpoint } from '@webaibuilder/core';

import type { RawCommit } from './repo';

/** Trailer-Metadaten eines Agent-Turns für den Checkpoint-Commit. */
export interface CheckpointMeta {
  turnId?: string;
  backend?: BackendId;
  sessionId?: string;
  costUsd?: number;
}

const TRAILER_PREFIX = 'Wab-';
const TRAILER_RE = /^Wab-([A-Za-z-]+):[ \t]*(.*)$/;

/** Geschlossene Menge der Backend-IDs aus core — für sicheres Zurücklesen. */
const BACKEND_IDS: ReadonlySet<string> = new Set([
  'claude-sdk',
  'claude-cli',
  'codex',
  'gemini-cli',
  'grok-cli',
  'byok',
]);

/** Erste Zeile eines Texts, getrimmt (Subject einer Prompt/Message/Tag-Message). */
export function firstLine(text: string): string {
  return text.split('\n', 1)[0]?.trim() ?? '';
}

/** Trailer-Werte müssen einzeilig bleiben. */
function trailerValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Baut die volle Commit-Message: Subject + Leerzeile + Trailer-Block. */
export function buildCommitMessage(subject: string, meta?: CheckpointMeta): string {
  const trailers: string[] = [];
  if (meta?.turnId) trailers.push(`${TRAILER_PREFIX}Turn-Id: ${trailerValue(meta.turnId)}`);
  if (meta?.backend) trailers.push(`${TRAILER_PREFIX}Backend: ${trailerValue(meta.backend)}`);
  if (meta?.sessionId) trailers.push(`${TRAILER_PREFIX}Session-Id: ${trailerValue(meta.sessionId)}`);
  if (typeof meta?.costUsd === 'number' && Number.isFinite(meta.costUsd)) {
    trailers.push(`${TRAILER_PREFIX}Cost-Usd: ${meta.costUsd}`);
  }
  return trailers.length > 0 ? `${subject}\n\n${trailers.join('\n')}` : subject;
}

/** Interpretiert einen Roh-Commit als Checkpoint (Subject + Trailer zurücklesen). */
export function parseCheckpoint(commit: RawCommit, versionName?: string): Checkpoint {
  const lines = commit.body.split('\n');
  const checkpoint: Checkpoint = {
    id: commit.sha,
    message: lines[0]?.trim() ?? '',
    createdAt: new Date(commit.date).toISOString(),
  };
  // Erste Zeile ist immer das Subject — Trailer nur im Body suchen.
  for (const line of lines.slice(1)) {
    const match = TRAILER_RE.exec(line.trim());
    if (!match) continue;
    const value = match[2]?.trim() ?? '';
    if (value.length === 0) continue;
    switch (match[1]) {
      case 'Turn-Id':
        checkpoint.turnId = value;
        break;
      case 'Backend':
        if (BACKEND_IDS.has(value)) checkpoint.backend = value as BackendId;
        break;
      case 'Session-Id':
        checkpoint.sessionId = value;
        break;
      case 'Cost-Usd': {
        const cost = Number.parseFloat(value);
        if (Number.isFinite(cost)) checkpoint.costUsd = cost;
        break;
      }
    }
  }
  if (versionName) {
    checkpoint.versionName = versionName;
  }
  return checkpoint;
}
