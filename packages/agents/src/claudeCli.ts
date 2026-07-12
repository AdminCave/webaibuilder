/**
 * `claude-cli`-Adapter (Abo, PLAN §4 + §3) — spawnt die vom NUTZER installierte
 * und eingeloggte offizielle Claude-Code-CLI:
 *
 *   claude -p --output-format stream-json --input-format stream-json \
 *          --include-partial-messages --verbose --permission-mode <mode>
 *
 * cwd = `<workspace>/site`. Der Prompt geht als stream-json-User-Nachricht auf
 * stdin. Der JSONL-Ausgabestrom wird auf core-`AgentEvent`s gemappt.
 *
 * Compliance (PLAN §3, nicht verhandelbar): Die App nutzt den EIGENEN Login der
 * `claude`-CLI. Es werden KEINE Credentials/Tokens gelesen, gespeichert oder
 * gesetzt; KEIN `ANTHROPIC_BASE_URL`. Der Adapter ist hinter einem Feature-Flag
 * gedacht (In-App-Hinweis, PLAN §6).
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

/** Deep-Link auf die offizielle Installationsanleitung (Onboarding, PLAN §6). */
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
 * Baut das permission-request-Event aus einer CLI-`control_request`-Zeile.
 * Der Adapter tolerert Protokoll-Drift: sowohl `control_request` als auch
 * `sdk_control_request`, sowohl `can_use_tool` als auch `permission`.
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
    // Session-Resume via --resume, partielle Deltas via --include-partial-messages,
    // Kosten aus der result-Nachricht.
    return { resume: true, partialText: true, cost: true };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Claude Code nicht gefunden — installiere es von ${CLAUDE_CLI_INSTALL_URL} und logge dich mit deinem Abo ein.`,
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
      // Prompt als stream-json-User-Nachricht auf stdin (kein positional prompt).
      stdinInit: [{ type: 'user', message: { role: 'user', content: req.prompt } }],
      // Offen halten, um control_response-Antworten zu schreiben.
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
      : { behavior: 'deny', message: 'Vom Nutzer abgelehnt.' };
    // control_response über stdin, korreliert per request_id (PLAN §11-Naht).
    return {
      type: 'control_response',
      response: { subtype: 'success', request_id: event.requestId, response: inner },
    };
  },
};

/** Erzeugt den claude-cli-Adapter (Abo, offizielle Vendor-CLI). */
export function createClaudeCliBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(claudeCliSpec, config);
}

export { claudeCliSpec };
