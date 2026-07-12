/**
 * `byok`-Adapter (bring-your-own-key, Dyad-Muster) — PLAN §4.
 *
 * Ein Vercel-AI-SDK-`streamText`-Tool-Loop mit workspace-scoped Datei-Tools.
 * Anbieter/Modell kommen aus der Config; der `fullStream` wird auf den
 * core-`AgentEvent`-Strom abgebildet:
 *   text-delta → text-delta · tool-call/-result → tool-activity ·
 *   finish → turn-complete · error/abort → error/turn-complete(interrupted).
 *
 * Datei-Änderungen erzeugen KEINE Events (ground truth = chokidar-Watcher).
 */

import { randomUUID } from 'node:crypto';

import type {
  AgentBackend,
  AgentCapabilities,
  AgentEvent,
  AgentTurnRequest,
  TurnStopReason,
} from '@webaibuilder/core';
import { type LanguageModel, stepCountIs, streamText } from 'ai';

import { resolveModel, type ByokProvider } from './providers';
import { createSiteTools } from './tools';

/** Konstruktionsdaten für den byok-Adapter. */
export interface ByokConfig {
  provider: ByokProvider;
  apiKey: string;
  model?: string;
  /**
   * Fertiges Sprachmodell direkt injizieren (überspringt {@link resolveModel}).
   * Für eigene Provider-Instanzen und Tests; wenn gesetzt, ist `apiKey` optional.
   */
  languageModel?: LanguageModel;
}

/** Obergrenze für Tool-Schritte pro Turn (verhindert Endlosschleifen). */
const MAX_STEPS = 24;

const SYSTEM_PROMPT = [
  'Du bist der KI-Baumeister von Web AI Builder und baust statische Webseiten',
  '(reines HTML/CSS/JS, kein Build-Step).',
  'Du arbeitest ausschließlich mit den bereitgestellten Datei-Tools im Ordner site/.',
  'Alle Pfade sind relativ zu site/. Du darfst nichts außerhalb von site/ anfassen.',
  'Schreibe sauberes, semantisches HTML und modernes CSS. Antworte knapp auf Deutsch (Du-Form).',
].join(' ');

function toolLabel(toolName: string): string {
  switch (toolName) {
    case 'read_file':
      return 'Datei lesen';
    case 'write_file':
      return 'Datei schreiben';
    case 'edit_file':
      return 'Datei bearbeiten';
    case 'list_dir':
      return 'Ordner auflisten';
    case 'glob':
      return 'Dateien suchen';
    default:
      return toolName;
  }
}

function toolDetail(toolName: string, input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  if (toolName === 'glob') {
    return typeof record.pattern === 'string' ? record.pattern : undefined;
  }
  const path = typeof record.path === 'string' ? record.path : undefined;
  if (path === undefined) return toolName === 'list_dir' ? 'site/' : undefined;
  const clean = path.replace(/^\.?\/*/, '');
  return `site/${clean}`;
}

class ByokBackend implements AgentBackend {
  readonly id = 'byok' as const;
  readonly #model: LanguageModel;
  #controller: AbortController | null = null;

  constructor(config: ByokConfig) {
    if (config.languageModel) {
      this.#model = config.languageModel;
      return;
    }
    if (!config.apiKey) {
      throw new Error('Für "byok" brauchst du einen API-Key.');
    }
    this.#model = resolveModel(config.provider, config.apiKey, config.model);
  }

  capabilities(): AgentCapabilities {
    // Kein Session-Resume (zustandslos), Text-Streaming ja, Kosten liefert das
    // AI SDK nicht → cost false.
    return { resume: false, partialText: true, cost: false };
  }

  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const controller = new AbortController();
    this.#controller = controller;
    const turnId = randomUUID();
    const calls = new Map<string, string>(); // toolCallId → toolName
    let stopReason: TurnStopReason = 'end';

    try {
      const result = streamText({
        model: this.#model,
        system: SYSTEM_PROMPT,
        prompt: req.prompt,
        tools: createSiteTools(req.siteDir),
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: controller.signal,
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta': {
            if (part.text.length > 0) yield { type: 'text-delta', text: part.text };
            break;
          }
          case 'tool-call': {
            calls.set(part.toolCallId, part.toolName);
            yield {
              type: 'tool-activity',
              toolCallId: part.toolCallId,
              tool: toolLabel(part.toolName),
              phase: 'start',
              detail: toolDetail(part.toolName, part.input),
            };
            break;
          }
          case 'tool-result': {
            const name = calls.get(part.toolCallId) ?? part.toolName;
            yield {
              type: 'tool-activity',
              toolCallId: part.toolCallId,
              tool: toolLabel(name),
              phase: 'end',
              detail: toolDetail(name, part.input),
            };
            break;
          }
          case 'tool-error': {
            const name = calls.get(part.toolCallId) ?? part.toolName;
            yield {
              type: 'tool-activity',
              toolCallId: part.toolCallId,
              tool: toolLabel(name),
              phase: 'end',
              detail: toolDetail(name, part.input),
            };
            yield {
              type: 'error',
              message: `Das Tool "${toolLabel(name)}" ist fehlgeschlagen.`,
              recoverable: true,
              cause: String(part.error),
            };
            break;
          }
          case 'abort': {
            stopReason = 'interrupted';
            break;
          }
          case 'error': {
            stopReason = 'error';
            yield {
              type: 'error',
              message: 'Der KI-Anbieter hat einen Fehler gemeldet.',
              recoverable: true,
              cause: String(part.error),
            };
            break;
          }
          default:
            break;
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        stopReason = 'interrupted';
      } else {
        stopReason = 'error';
        yield {
          type: 'error',
          message: 'Der Turn konnte nicht abgeschlossen werden.',
          recoverable: true,
          cause: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      this.#controller = null;
    }

    yield { type: 'turn-complete', turnId, stopReason };
  }

  async interrupt(): Promise<void> {
    this.#controller?.abort();
  }
}

/** Erzeugt den byok-Adapter. */
export function createByokBackend(config: ByokConfig): AgentBackend {
  return new ByokBackend(config);
}
