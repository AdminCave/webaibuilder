/**
 * Commit message format of the checkpoints (PLAN §4):
 * subject = first prompt line; turn metadata as git trailers in the body.
 * Format one way (buildCommitMessage) and back (parseCheckpoint).
 */

import type { BackendId, Checkpoint } from '@webaibuilder/core';

import type { RawCommit } from './repo';

/** Trailer metadata of an agent turn for the checkpoint commit. */
export interface CheckpointMeta {
  turnId?: string;
  backend?: BackendId;
  sessionId?: string;
  costUsd?: number;
}

const TRAILER_PREFIX = 'Wab-';
const TRAILER_RE = /^Wab-([A-Za-z-]+):[ \t]*(.*)$/;

/** Closed set of backend IDs from core — for safe read-back. */
const BACKEND_IDS: ReadonlySet<string> = new Set([
  'claude-sdk',
  'claude-cli',
  'codex',
  'gemini-cli',
  'grok-cli',
  'byok',
]);

/** First line of a text, trimmed (subject of a prompt/message/tag message). */
export function firstLine(text: string): string {
  return text.split('\n', 1)[0]?.trim() ?? '';
}

/** Trailer values must stay single-line. */
function trailerValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Builds the full commit message: subject + blank line + trailer block. */
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

/** Interprets a raw commit as a checkpoint (read back subject + trailers). */
export function parseCheckpoint(commit: RawCommit, versionName?: string): Checkpoint {
  const lines = commit.body.split('\n');
  const checkpoint: Checkpoint = {
    id: commit.sha,
    message: lines[0]?.trim() ?? '',
    createdAt: new Date(commit.date).toISOString(),
  };
  // The first line is always the subject — only search for trailers in the body.
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
