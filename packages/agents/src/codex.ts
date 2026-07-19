/**
 * `codex` adapter (subscription OR API key — the CLI decides, PLAN §4) — spawns
 * the user-installed OpenAI Codex CLI:
 *
 *   codex exec --json "<prompt>"                    (new turn)
 *   codex exec resume <sessionId> --json "<prompt>" (resume session)
 *
 * cwd = `<workspace>/site`. The JSONL stream (`thread.*`, `turn.*`, `item.*`)
 * is mapped onto core `AgentEvent`s. There is no token streaming: the final
 * answer arrives as a single `item.completed` with `item.type === "agent_message"`.
 *
 * Compliance (PLAN §3): The app passes NOTHING through (no key, no token) — the
 * `codex` CLI uses the login/key the user set up themselves.
 */

import type {
  AgentBackend,
  AgentCapabilities,
  AgentErrorEvent,
  AgentEvent,
  AgentTurnRequest,
  ToolActivityPhase,
} from '@webaibuilder/core';

import {
  createCliBackend,
  type CliBackendConfig,
  type CliInvocation,
  type CliSpec,
  type TurnState,
} from './cliEngine';

/** Deep link to the official installation guide (onboarding, PLAN §6). */
export const CODEX_INSTALL_URL = 'https://developers.openai.com/codex/cli/';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function phaseOf(eventType: string | undefined): ToolActivityPhase {
  if (eventType === 'item.completed') return 'end';
  if (eventType === 'item.updated') return 'update';
  return 'start';
}

function firstChangedPath(item: Record<string, unknown>): string | undefined {
  const changes = item.changes;
  if (!Array.isArray(changes) || changes.length === 0) return undefined;
  const first = asRecord(changes[0]);
  return asString(first?.path);
}

const codexSpec: CliSpec = {
  id: 'codex',
  binary: 'codex',

  capabilities(): AgentCapabilities {
    // Resume via `codex exec resume <thread_id>`; NO token streaming; codex
    // exec --json reports only token usage, no USD → cost false.
    return { resume: true, partialText: false, cost: false };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Codex CLI not found — install it from ${CODEX_INSTALL_URL} and sign in with your ChatGPT subscription or API key.`,
      recoverable: false,
    };
  },

  buildInvocation(req: AgentTurnRequest): CliInvocation {
    const args =
      req.sessionId !== undefined
        ? ['exec', 'resume', req.sessionId, '--json', req.prompt]
        : ['exec', '--json', req.prompt];
    return { args, keepStdinOpen: false };
  },

  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[] {
    const type = asString(json.type);
    switch (type) {
      case 'thread.started': {
        const id = asString(json.thread_id);
        if (id !== undefined) state.sessionId = id;
        return [];
      }
      case 'turn.started':
        return [];
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = asRecord(json.item);
        if (!item) return [];
        const itemType = asString(item.type);
        const id = asString(item.id) ?? 'item';
        const phase = phaseOf(type);
        switch (itemType) {
          case 'agent_message': {
            // Emit the final answer only on completion, as a single (whole) text.
            const text = asString(item.text);
            if (type === 'item.completed' && text !== undefined && text.length > 0) {
              return [{ type: 'text-delta', text }];
            }
            return [];
          }
          case 'reasoning':
            return []; // do not display internal reasoning
          case 'command_execution':
            return [
              {
                type: 'tool-activity',
                toolCallId: id,
                tool: 'Shell command',
                phase,
                ...(asString(item.command) ? { detail: asString(item.command) } : {}),
              },
            ];
          case 'file_change': {
            const path = firstChangedPath(item);
            return [
              {
                type: 'tool-activity',
                toolCallId: id,
                tool: 'Edit file',
                phase,
                ...(path ? { detail: path } : {}),
              },
            ];
          }
          case 'mcp_tool_call':
            return [
              {
                type: 'tool-activity',
                toolCallId: id,
                tool: asString(item.tool) ?? 'MCP tool',
                phase,
                ...(asString(item.server) ? { detail: asString(item.server) } : {}),
              },
            ];
          case 'web_search':
            return [
              {
                type: 'tool-activity',
                toolCallId: id,
                tool: 'Web search',
                phase,
                ...(asString(item.query) ? { detail: asString(item.query) } : {}),
              },
            ];
          default:
            return [];
        }
      }
      case 'turn.completed': {
        state.done = true;
        return [];
      }
      case 'turn.failed': {
        state.stopReason = 'error';
        state.done = true;
        const message = asString(asRecord(json.error)?.message);
        return [
          {
            type: 'error',
            message: 'Codex aborted the turn.',
            recoverable: true,
            ...(message ? { cause: message } : {}),
          },
        ];
      }
      case 'error': {
        state.stopReason = 'error';
        const message = asString(json.message);
        return [
          {
            type: 'error',
            message: 'Codex reported an error.',
            recoverable: true,
            ...(message ? { cause: message } : {}),
          },
        ];
      }
      default:
        return [];
    }
  },
};

/** Creates the codex adapter (subscription or API key, official vendor CLI). */
export function createCodexBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(codexSpec, config);
}

export { codexSpec };
