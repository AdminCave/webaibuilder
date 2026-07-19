/**
 * `claude-sdk` adapter (API key) — PLAN §4.
 *
 * Drives `@anthropic-ai/claude-agent-sdk` `query()` (async generator).
 * cwd = `<workspaceDir>/site/`; PermissionMode comes from the PermissionPolicy
 * (acceptEdits for auto-approve). The message/tool stream is mapped onto the
 * core `AgentEvent` stream, `canUseTool` onto `permission-request`.
 * Cost/session from the `result` message → `turn-complete`.
 *
 * Compliance (PLAN §3): This adapter uses the API key (not subscription OAuth),
 * sets `ANTHROPIC_API_KEY` only in the subprocess env, and never touches tokens.
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

/** Construction data for the claude-sdk adapter. */
export interface ClaudeSdkConfig {
  /** ANTHROPIC_API_KEY; when empty, the subprocess reads it from the environment. */
  apiKey?: string;
  /** Model override (e.g. "claude-opus-4-8"). */
  model?: string;
}

/** Read-only tools (always allowed) vs. a policy scope. */
export type ToolClass = PermissionScope | 'read';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Update']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillBash', 'KillShell']);
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);

/** PermissionPolicy → SDK PermissionMode (acceptEdits for auto-approve). */
export function mapPermissionMode(policy: PermissionPolicy): PermissionMode {
  return ruleFor(policy, 'edit-in-site') === 'allow' ? 'acceptEdits' : 'default';
}

export function pathFromInput(input: Record<string, unknown>): string | undefined {
  const candidate = input.file_path ?? input.path ?? input.notebook_path;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Synchronous scope classification by tool name only (no FS/realpath).
 * For the CLI adapters, whose permission prompt comes from the vendor process
 * and must be mapped synchronously onto a `permission-request`.
 */
export function classifyScopeByName(toolName: string): PermissionScope {
  if (SHELL_TOOLS.has(toolName)) return 'shell';
  if (NETWORK_TOOLS.has(toolName)) return 'network';
  if (EDIT_TOOLS.has(toolName)) return 'edit-in-site';
  // Treat unknown tools fail-safe as shell → prompt/deny.
  return 'shell';
}

/** Classifies a tool call into a policy scope (or `read`). */
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
  // Treat unknown tools (e.g. MCP) fail-safe as shell → prompt/deny.
  return 'shell';
}

export function toolDisplayName(toolName: string): string {
  if (toolName === 'Write') return 'Write file';
  if (EDIT_TOOLS.has(toolName)) return 'Edit file';
  if (toolName === 'Read' || toolName === 'NotebookRead') return 'Read file';
  if (toolName === 'Glob' || toolName === 'Grep') return 'Find files';
  if (toolName === 'LS') return 'List folder';
  if (SHELL_TOOLS.has(toolName)) return 'Shell command';
  if (NETWORK_TOOLS.has(toolName)) return 'Web access';
  return toolName;
}

export function scopeDescription(scope: PermissionScope, toolName: string): string {
  switch (scope) {
    case 'shell':
      return `May I run the shell command "${toolName}"?`;
    case 'network':
      return `May I access the network ("${toolName}")?`;
    case 'edit-outside-site':
      return `May I modify a file outside of site/ ("${toolName}")?`;
    default:
      return `May I run "${toolName}"?`;
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
    // Session resume yes, partial text deltas (includePartialMessages), cost
    // from the result message → cost true.
    return { resume: true, partialText: true, cost: true };
  }

  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const controller = new AbortController();
    this.#controller = controller;
    const turnId = randomUUID();
    const queue = new AsyncQueue<AgentEvent>();
    const toolNames = new Map<string, string>(); // tool_use_id → toolName
    // Open permission requests: requestId → resolver that passes the user's
    // decision (from the `yield` back-channel) to the waiting canUseTool.
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
              ? 'Access denied: I may only modify files under site/.'
              : `Access denied (${klass}).`,
        };
      }
      // prompt → surface it AND wait for the user's decision. The back-channel
      // is the return value of `yield` (the desktop drives the iterator with
      // `next(decision)`). If the generator is exhausted without a decision, the
      // back-channel resolves to `undefined` → fail-safe deny.
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
      return { behavior: 'deny', message: 'Denied by the user.' };
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
            message: 'The Claude turn could not be completed.',
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
        // Pass the user's answer to a permission-request back to the waiting
        // canUseTool (fail-safe deny when `resume` is undefined).
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
      // Discard any still-open requests fail-safe (e.g. on abort) so that
      // canUseTool does not hang forever.
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
      // A single-shot prompt may not support control requests — abort suffices.
    }
    this.#controller?.abort();
  }
}

/** Creates the claude-sdk adapter. */
export function createClaudeSdkBackend(config: ClaudeSdkConfig): AgentBackend {
  return new ClaudeSdkBackend(config);
}
