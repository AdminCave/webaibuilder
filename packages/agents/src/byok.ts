/**
 * `byok` adapter (bring-your-own-key, Dyad pattern) — PLAN §4.
 *
 * A Vercel AI SDK `streamText` tool loop with workspace-scoped file tools.
 * Provider/model come from the config; the `fullStream` is mapped onto the
 * core `AgentEvent` stream:
 *   text-delta → text-delta · tool-call/-result → tool-activity ·
 *   finish → turn-complete · error/abort → error/turn-complete(interrupted).
 *
 * File changes produce NO events (ground truth = chokidar watcher).
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

/** Construction data for the byok adapter. */
export interface ByokConfig {
  provider: ByokProvider;
  apiKey: string;
  model?: string;
  /**
   * Inject a ready-made language model directly (skips {@link resolveModel}).
   * For custom provider instances and tests; when set, `apiKey` is optional.
   */
  languageModel?: LanguageModel;
}

/** Upper bound on tool steps per turn (prevents infinite loops). */
const MAX_STEPS = 24;

const SYSTEM_PROMPT = [
  'You are the AI builder of Web AI Builder and you build static websites',
  '(plain HTML/CSS/JS, no build step).',
  'You work exclusively with the provided file tools in the site/ folder.',
  'All paths are relative to site/. You must not touch anything outside of site/.',
  'Write clean, semantic HTML and modern CSS. Respond concisely in English.',
].join(' ');

function toolLabel(toolName: string): string {
  switch (toolName) {
    case 'read_file':
      return 'Read file';
    case 'write_file':
      return 'Write file';
    case 'edit_file':
      return 'Edit file';
    case 'list_dir':
      return 'List folder';
    case 'glob':
      return 'Find files';
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
      throw new Error('"byok" requires an API key.');
    }
    this.#model = resolveModel(config.provider, config.apiKey, config.model);
  }

  capabilities(): AgentCapabilities {
    // No session resume (stateless), text streaming yes, the AI SDK does not
    // report cost → cost false.
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
              message: `The tool "${toolLabel(name)}" failed.`,
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
              message: 'The AI provider reported an error.',
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
          message: 'The turn could not be completed.',
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

/** Creates the byok adapter. */
export function createByokBackend(config: ByokConfig): AgentBackend {
  return new ByokBackend(config);
}
