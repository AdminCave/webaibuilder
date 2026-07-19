/**
 * `grok-cli` adapter (experimental, PLAN §4 + §3) — spawns the user-installed
 * official Grok Build CLI in headless mode:
 *
 *   grok -p "<prompt>" --output-format streaming-json --no-auto-update
 *
 * cwd = `<workspace>/site`. Without `--output-format`, Grok emits
 * human-readable text; `streaming-json` yields JSONL events (ACP-like:
 * `session/update` with `agent_message_chunk`/`tool_call`). The exact schema is
 * the least documented — the mapper is deliberately tolerant and covers several
 * shapes.
 *
 * Compliance (PLAN §3): Official; spawning your own CLI is tolerated. The app
 * passes no credentials through — the CLI uses its own SuperGrok login.
 * Marked as "experimental" (PLAN status line xAI).
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

/** Deep link to the official installation guide (onboarding, PLAN §6).
 *  On an allowed vendor domain (x.ai). */
export const GROK_CLI_INSTALL_URL = 'https://docs.x.ai/docs/overview';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Extract text from an ACP `content` field (string or `{type:'text',text}`). */
function contentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  const record = asRecord(content);
  return asString(record?.text);
}

function statusPhase(status: string | undefined): ToolActivityPhase {
  if (status === 'completed' || status === 'success' || status === 'failed' || status === 'error') {
    return 'end';
  }
  if (status === 'in_progress' || status === 'running') return 'update';
  return 'start';
}

/** ACP `session/update` notification → AgentEvents. */
function mapSessionUpdate(update: Record<string, unknown>, state: TurnState): AgentEvent[] {
  const kind = asString(update.sessionUpdate);
  switch (kind) {
    case 'agent_message_chunk':
    case 'agent_message': {
      const text = contentText(update.content);
      if (text !== undefined && text.length > 0) return [{ type: 'text-delta', text }];
      return [];
    }
    case 'agent_thought_chunk':
      return []; // do not display internal reasoning
    case 'tool_call':
    case 'tool_call_update': {
      const id = asString(update.toolCallId) ?? asString(update.id) ?? 'tool';
      const label = asString(update.title) ?? asString(update.kind) ?? 'Tool';
      const phase = statusPhase(asString(update.status));
      if (phase === 'start') state.tools.set(id, label);
      return [
        {
          type: 'tool-activity',
          toolCallId: id,
          tool: state.tools.get(id) ?? label,
          phase,
        },
      ];
    }
    default:
      return [];
  }
}

const grokCliSpec: CliSpec = {
  id: 'grok-cli',
  binary: 'grok',

  capabilities(): AgentCapabilities {
    // Experimental: text streaming yes; resume/cost not reliable.
    return { resume: false, partialText: true, cost: false };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Grok Build CLI not found — install it from ${GROK_CLI_INSTALL_URL} and sign in with your SuperGrok account (experimental).`,
      recoverable: false,
    };
  },

  buildInvocation(req: AgentTurnRequest): CliInvocation {
    // `-p` = single headless prompt; streaming-json makes the output parseable.
    const args = ['-p', req.prompt, '--output-format', 'streaming-json', '--no-auto-update'];
    return { args, keepStdinOpen: false };
  },

  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[] {
    // 1) ACP JSON-RPC notification (`method: "session/update"`).
    if (asString(json.method) === 'session/update') {
      const params = asRecord(json.params);
      const update = asRecord(params?.update);
      if (update) return mapSessionUpdate(update, state);
      return [];
    }
    // 2) Directly embedded `update` object.
    const directUpdate = asRecord(json.update);
    if (directUpdate) return mapSessionUpdate(directUpdate, state);

    // 3) Generic, flat shapes (defensive against schema drift).
    const type = asString(json.type);
    switch (type) {
      case 'text':
      case 'assistant':
      case 'message': {
        const text = asString(json.text) ?? contentText(json.content);
        if (text !== undefined && text.length > 0) return [{ type: 'text-delta', text }];
        return [];
      }
      case 'tool_use':
      case 'tool_call': {
        const id = asString(json.tool_id) ?? asString(json.id) ?? 'tool';
        const label = asString(json.tool_name) ?? asString(json.name) ?? 'Tool';
        state.tools.set(id, label);
        return [{ type: 'tool-activity', toolCallId: id, tool: label, phase: 'start' }];
      }
      case 'error': {
        state.stopReason = 'error';
        const message = asString(json.message);
        return [
          {
            type: 'error',
            message: 'Grok reported an error.',
            recoverable: true,
            ...(message ? { cause: message } : {}),
          },
        ];
      }
      case 'result':
      case 'turn.completed':
      case 'done': {
        const cost = asRecord(json.stats)?.total_cost_usd ?? json.total_cost_usd;
        if (typeof cost === 'number') state.costUsd = cost;
        state.done = true;
        return [];
      }
      default:
        return [];
    }
  },
};

/** Creates the grok-cli adapter (experimental, official vendor CLI). */
export function createGrokCliBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(grokCliSpec, config);
}

export { grokCliSpec };
