/**
 * `claude-cli` adapter (subscription, PLAN §4 + §3) — spawns the official
 * Claude Code CLI that the USER has installed and logged in to:
 *
 *   claude -p --output-format stream-json --input-format stream-json \
 *          --include-partial-messages --verbose --permission-mode <mode>
 *
 * cwd = `<workspace>/site`. The prompt is sent as a stream-json user message on
 * stdin. The JSONL output stream is mapped onto core `AgentEvent`s.
 *
 * Compliance (PLAN §3, non-negotiable): The app uses the `claude` CLI's OWN
 * login. NO credentials/tokens are read, stored, or set; NO `ANTHROPIC_BASE_URL`.
 * The adapter is intended to sit behind a feature flag (in-app notice, PLAN §6).
 */

import type {
  AgentBackend,
  AgentCapabilities,
  AgentErrorEvent,
  AgentEvent,
  AgentTurnRequest,
  PermissionDecision,
  PermissionRequestEvent,
} from '@webaibuilder/core';

import {
  classifyScopeByName,
  mapPermissionMode,
  pathFromInput,
  scopeDescription,
  toolDisplayName,
} from './claudeSdk';
import {
  createCliBackend,
  type CliBackendConfig,
  type CliInvocation,
  type CliSpec,
  type TurnState,
} from './cliEngine';

/** Deep link to the official installation guide (onboarding, PLAN §6). */
export const CLAUDE_CLI_INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code/setup';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  delta?: { type?: string; text?: string };
}

function blocksOf(message: unknown): ContentBlock[] {
  const content = asRecord(message)?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

/**
 * Builds the permission-request event from a CLI `control_request` line.
 * The adapter tolerates protocol drift: both `control_request` and
 * `sdk_control_request`, both `can_use_tool` and `permission`.
 */
function permissionFromControl(json: Record<string, unknown>): PermissionRequestEvent | null {
  const request = asRecord(json.request);
  if (!request) return null;
  const subtype = asString(request.subtype);
  if (subtype !== 'can_use_tool' && subtype !== 'permission') return null;
  const requestId = asString(json.request_id) ?? asString(request.request_id);
  if (requestId === undefined) return null;
  const toolName = asString(request.tool_name) ?? 'Tool';
  const input = asRecord(request.input) ?? asRecord(request.tool_input) ?? {};
  const scope = classifyScopeByName(toolName);
  return {
    type: 'permission-request',
    requestId,
    scope,
    description: scopeDescription(scope, toolName),
    payload: { tool: toolName, input },
  };
}

const claudeCliSpec: CliSpec = {
  id: 'claude-cli',
  binary: 'claude',

  capabilities(): AgentCapabilities {
    // Session resume via --resume, partial deltas via --include-partial-messages,
    // cost from the result message.
    return { resume: true, partialText: true, cost: true };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Claude Code not found — install it from ${CLAUDE_CLI_INSTALL_URL} and log in with your subscription.`,
      recoverable: false,
    };
  },

  buildInvocation(req: AgentTurnRequest): CliInvocation {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      mapPermissionMode(req.policy),
    ];
    if (req.sessionId !== undefined) args.push('--resume', req.sessionId);
    return {
      args,
      // Prompt as a stream-json user message on stdin (no positional prompt).
      stdinInit: [{ type: 'user', message: { role: 'user', content: req.prompt } }],
      // Keep open to write control_response replies.
      keepStdinOpen: true,
    };
  },

  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[] {
    const type = asString(json.type);
    switch (type) {
      case 'system': {
        if (asString(json.subtype) === 'init') {
          const sid = asString(json.session_id);
          if (sid !== undefined) state.sessionId = sid;
        }
        return [];
      }
      case 'stream_event': {
        const event = asRecord(json.event);
        const delta = asRecord(event?.delta);
        if (
          asString(event?.type) === 'content_block_delta' &&
          asString(delta?.type) === 'text_delta'
        ) {
          const text = asString(delta?.text);
          if (text !== undefined && text.length > 0) return [{ type: 'text-delta', text }];
        }
        return [];
      }
      case 'assistant': {
        const out: AgentEvent[] = [];
        for (const block of blocksOf(json.message)) {
          if (block.type === 'tool_use' && typeof block.id === 'string') {
            const label = toolDisplayName(block.name ?? 'Tool');
            state.tools.set(block.id, label);
            out.push({
              type: 'tool-activity',
              toolCallId: block.id,
              tool: label,
              phase: 'start',
              ...(block.input ? { detail: pathFromInput(block.input) } : {}),
            });
          }
        }
        return out;
      }
      case 'user': {
        const out: AgentEvent[] = [];
        for (const block of blocksOf(json.message)) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            out.push({
              type: 'tool-activity',
              toolCallId: block.tool_use_id,
              tool: state.tools.get(block.tool_use_id) ?? 'Tool',
              phase: 'end',
            });
          }
        }
        return out;
      }
      case 'result': {
        const cost = json.total_cost_usd;
        if (typeof cost === 'number') state.costUsd = cost;
        const sid = asString(json.session_id);
        if (sid !== undefined) state.sessionId = sid;
        if (asString(json.subtype) !== 'success') state.stopReason = 'error';
        state.done = true;
        return [];
      }
      case 'control_request':
      case 'sdk_control_request': {
        const event = permissionFromControl(json);
        return event ? [event] : [];
      }
      default:
        return [];
    }
  },

  answerPermission(event: PermissionRequestEvent, decision: PermissionDecision | undefined): unknown {
    const input = asRecord(event.payload?.input) ?? {};
    const inner = decision?.allow
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Denied by the user.' };
    // control_response over stdin, correlated by request_id (PLAN §11 seam).
    return {
      type: 'control_response',
      response: { subtype: 'success', request_id: event.requestId, response: inner },
    };
  },
};

/** Creates the claude-cli adapter (subscription, official vendor CLI). */
export function createClaudeCliBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(claudeCliSpec, config);
}

export { claudeCliSpec };
