/**
 * `claude-sdk`-Adapter (API-Key) — PLAN §4.
 *
 * Treibt `@anthropic-ai/claude-agent-sdk` `query()` (async generator).
 * cwd = `<workspaceDir>/site/`; PermissionMode aus der PermissionPolicy
 * (acceptEdits für Auto-Approve). Der Message-/Tool-Strom wird auf den
 * core-`AgentEvent`-Strom abgebildet, `canUseTool` auf `permission-request`.
 * Kosten/Session aus der `result`-Nachricht → `turn-complete`.
 *
 * Compliance (PLAN §3): Dieser Adapter nutzt den API-Key (kein Abo-OAuth),
 * setzt `ANTHROPIC_API_KEY` nur im Subprozess-Env, fasst keine Tokens an.
 */

import { randomUUID } from 'node:crypto';

import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentBackend,
  AgentCapabilities,
  AgentEvent,
  AgentTurnRequest,
  PermissionDecision,
  PermissionPolicy,
  PermissionScope,
  TurnStopReason,
} from '@webaibuilder/core';

import { AsyncQueue } from './asyncQueue';
import { PathEscapeError, resolveInSite } from './paths';
import { ruleFor } from './permissions';

/** Konstruktionsdaten für den claude-sdk-Adapter. */
export interface ClaudeSdkConfig {
  /** ANTHROPIC_API_KEY; wenn leer, zieht der Subprozess ihn aus der Umgebung. */
  apiKey?: string;
  /** Modell-Override (z. B. "claude-opus-4-8"). */
  model?: string;
}

/** Reine Lese-Tools (immer erlaubt) vs. ein Policy-Scope. */
export type ToolClass = PermissionScope | 'read';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Update']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillBash', 'KillShell']);
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);

/** PermissionPolicy → SDK-PermissionMode (acceptEdits für Auto-Approve). */
export function mapPermissionMode(policy: PermissionPolicy): PermissionMode {
  return ruleFor(policy, 'edit-in-site') === 'allow' ? 'acceptEdits' : 'default';
}

export function pathFromInput(input: Record<string, unknown>): string | undefined {
  const candidate = input.file_path ?? input.path ?? input.notebook_path;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Synchrone Scope-Klassifikation nur nach Tool-Name (ohne FS/realpath).
 * Für die CLI-Adapter, deren Permission-Prompt aus dem Vendor-Prozess kommt
 * und synchron auf ein `permission-request` gemappt werden muss.
 */
export function classifyScopeByName(toolName: string): PermissionScope {
  if (SHELL_TOOLS.has(toolName)) return 'shell';
  if (NETWORK_TOOLS.has(toolName)) return 'network';
  if (EDIT_TOOLS.has(toolName)) return 'edit-in-site';
  // Unbekannte Tools fail-safe als Shell behandeln → Prompt/Deny.
  return 'shell';
}

/** Klassifiziert einen Tool-Aufruf in einen Policy-Scope (bzw. `read`). */
export async function classifyTool(
  toolName: string,
  input: Record<string, unknown>,
  siteDir: string,
): Promise<ToolClass> {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (SHELL_TOOLS.has(toolName)) return 'shell';
  if (NETWORK_TOOLS.has(toolName)) return 'network';
  if (EDIT_TOOLS.has(toolName)) {
    const path = pathFromInput(input);
    if (path === undefined) return 'edit-in-site';
    try {
      await resolveInSite(siteDir, path);
      return 'edit-in-site';
    } catch (err) {
      if (err instanceof PathEscapeError) return 'edit-outside-site';
      return 'edit-outside-site';
    }
  }
  // Unbekannte Tools (z. B. MCP) fail-safe als Shell behandeln → Prompt/Deny.
  return 'shell';
}

export function toolDisplayName(toolName: string): string {
  if (toolName === 'Write') return 'Datei schreiben';
  if (EDIT_TOOLS.has(toolName)) return 'Datei bearbeiten';
  if (toolName === 'Read' || toolName === 'NotebookRead') return 'Datei lesen';
  if (toolName === 'Glob' || toolName === 'Grep') return 'Dateien suchen';
  if (toolName === 'LS') return 'Ordner auflisten';
  if (SHELL_TOOLS.has(toolName)) return 'Shell-Befehl';
  if (NETWORK_TOOLS.has(toolName)) return 'Web-Zugriff';
  return toolName;
}

export function scopeDescription(scope: PermissionScope, toolName: string): string {
  switch (scope) {
    case 'shell':
      return `Darf ich den Shell-Befehl "${toolName}" ausführen?`;
    case 'network':
      return `Darf ich auf das Netz zugreifen ("${toolName}")?`;
    case 'edit-outside-site':
      return `Darf ich eine Datei außerhalb von site/ ändern ("${toolName}")?`;
    default:
      return `Darf ich "${toolName}" ausführen?`;
  }
}

interface TextBlock {
  type: 'text';
  text: string;
}
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}
interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
}

class ClaudeSdkBackend implements AgentBackend {
  readonly id = 'claude-sdk' as const;
  readonly #config: ClaudeSdkConfig;
  #query: Query | null = null;
  #controller: AbortController | null = null;

  constructor(config: ClaudeSdkConfig) {
    this.#config = config;
  }

  capabilities(): AgentCapabilities {
    // Session-Resume ja, partielle Text-Deltas (includePartialMessages), Kosten
    // aus der result-Nachricht → cost true.
    return { resume: true, partialText: true, cost: true };
  }

  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const controller = new AbortController();
    this.#controller = controller;
    const turnId = randomUUID();
    const queue = new AsyncQueue<AgentEvent>();
    const toolNames = new Map<string, string>(); // tool_use_id → toolName
    // Offene Permission-Anfragen: requestId → Resolver, der die Entscheidung des
    // Nutzers (aus dem `yield`-Rückkanal) an den wartenden canUseTool reicht.
    const pending = new Map<string, (decision: PermissionDecision | undefined) => void>();
    let sessionId: string | undefined = req.sessionId;
    let costUsd: number | undefined;
    let stopReason: TurnStopReason = 'end';

    const canUseTool: CanUseTool = async (toolName, input): Promise<PermissionResult> => {
      const klass = await classifyTool(toolName, input, req.siteDir);
      if (klass === 'read') return { behavior: 'allow', updatedInput: input };
      const rule = ruleFor(req.policy, klass);
      if (rule === 'allow') return { behavior: 'allow', updatedInput: input };
      if (rule === 'deny') {
        return {
          behavior: 'deny',
          message:
            klass === 'edit-outside-site'
              ? 'Zugriff verweigert: Ich darf nur Dateien unter site/ ändern.'
              : `Zugriff verweigert (${klass}).`,
        };
      }
      // prompt → sichtbar machen UND auf die Nutzer-Entscheidung warten. Der
      // Rückkanal ist der Rückgabewert des `yield` (Desktop treibt den Iterator
      // mit `next(decision)`). Wird der Generator ohne Entscheidung durchlaufen,
      // resolved der Rückkanal auf `undefined` → fail-safe deny.
      const requestId = randomUUID();
      const decision = await new Promise<PermissionDecision | undefined>((resolve) => {
        pending.set(requestId, resolve);
        queue.push({
          type: 'permission-request',
          requestId,
          scope: klass,
          description: scopeDescription(klass, toolName),
          payload: { tool: toolName, input },
        });
      });
      if (decision?.allow) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: 'Vom Nutzer abgelehnt.' };
    };

    const options: Options = {
      cwd: req.siteDir,
      permissionMode: mapPermissionMode(req.policy),
      includePartialMessages: true,
      abortController: controller,
      canUseTool,
      ...(req.sessionId ? { resume: req.sessionId } : {}),
      ...(this.#config.model ? { model: this.#config.model } : {}),
      ...(this.#config.apiKey
        ? { env: { ...process.env, ANTHROPIC_API_KEY: this.#config.apiKey } }
        : {}),
    };

    const q = query({ prompt: req.prompt, options });
    this.#query = q;

    const pump = (async () => {
      try {
        for await (const msg of q) {
          switch (msg.type) {
            case 'system': {
              if (msg.subtype === 'init') sessionId = msg.session_id;
              break;
            }
            case 'stream_event': {
              const event = msg.event as { type?: string; delta?: { type?: string; text?: string } };
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta' &&
                typeof event.delta.text === 'string' &&
                event.delta.text.length > 0
              ) {
                queue.push({ type: 'text-delta', text: event.delta.text });
              }
              break;
            }
            case 'assistant': {
              const blocks = (msg.message.content ?? []) as unknown as Array<
                TextBlock | ToolUseBlock | ToolResultBlock
              >;
              for (const block of blocks) {
                if (block.type === 'tool_use') {
                  toolNames.set(block.id, block.name);
                  queue.push({
                    type: 'tool-activity',
                    toolCallId: block.id,
                    tool: toolDisplayName(block.name),
                    phase: 'start',
                    detail: block.input ? pathFromInput(block.input) : undefined,
                  });
                }
              }
              break;
            }
            case 'user': {
              const blocks = (msg.message.content ?? []) as unknown as Array<
                TextBlock | ToolUseBlock | ToolResultBlock
              >;
              if (!Array.isArray(blocks)) break;
              for (const block of blocks) {
                if (block.type === 'tool_result') {
                  const name = toolNames.get(block.tool_use_id) ?? 'Tool';
                  queue.push({
                    type: 'tool-activity',
                    toolCallId: block.tool_use_id,
                    tool: toolDisplayName(name),
                    phase: 'end',
                  });
                }
              }
              break;
            }
            case 'result': {
              if (typeof msg.total_cost_usd === 'number') costUsd = msg.total_cost_usd;
              if (msg.session_id) sessionId = msg.session_id;
              if (msg.subtype !== 'success') stopReason = 'error';
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
          queue.push({
            type: 'error',
            message: 'Der Claude-Turn konnte nicht abgeschlossen werden.',
            recoverable: true,
            cause: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        queue.close();
      }
    })();

    try {
      for await (const event of queue) {
        const resume = yield event;
        // Antwort des Nutzers auf ein permission-request an den wartenden
        // canUseTool zurückreichen (fail-safe deny, wenn `resume` undefined ist).
        if (event.type === 'permission-request') {
          const resolve = pending.get(event.requestId);
          if (resolve) {
            pending.delete(event.requestId);
            resolve(resume as PermissionDecision | undefined);
          }
        }
      }
      await pump;
    } finally {
      // Noch offene Anfragen fail-safe verwerfen (z. B. bei Abbruch), damit
      // canUseTool nicht ewig hängt.
      for (const resolve of pending.values()) resolve(undefined);
      pending.clear();
      this.#query = null;
      this.#controller = null;
    }

    yield { type: 'turn-complete', turnId, stopReason, sessionId, costUsd };
  }

  async interrupt(): Promise<void> {
    try {
      await this.#query?.interrupt();
    } catch {
      // Single-shot-Prompt unterstützt evtl. keine Control-Requests — Abort reicht.
    }
    this.#controller?.abort();
  }
}

/** Erzeugt den claude-sdk-Adapter. */
export function createClaudeSdkBackend(config: ClaudeSdkConfig): AgentBackend {
  return new ClaudeSdkBackend(config);
}
