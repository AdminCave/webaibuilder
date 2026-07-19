/**
 * `gemini-cli` adapter (subscription/Google login, PLAN §4) — spawns the
 * user-installed official Gemini CLI in headless mode:
 *
 *   gemini --output-format stream-json --approval-mode auto_edit -p "<prompt>"
 *
 * cwd = `<workspace>/site`. The JSONL stream (`init`, `message`, `tool_use`,
 * `tool_result`, `error`, `result`) is mapped onto core `AgentEvent`s.
 *
 * Compliance (PLAN §3): Explicitly permitted for the Gemini CLI in its ToS. The
 * app passes no credentials through — the CLI uses its own Google login.
 *
 * Note (capabilities): Headless provides a session_id only in `init`; there is
 * no reliable resume here → `resume: false` (PLAN requirement).
 */

import type {
  AgentBackend,
  AgentCapabilities,
  AgentErrorEvent,
  AgentEvent,
  AgentTurnRequest,
} from '@webaibuilder/core';

import {
  createCliBackend,
  type CliBackendConfig,
  type CliInvocation,
  type CliSpec,
  type TurnState,
} from './cliEngine';

/** Deep link to the official installation guide (onboarding, PLAN §6).
 *  On an allowed vendor domain (google.dev) so the desktop onboarding link is
 *  allowed to open it. */
export const GEMINI_CLI_INSTALL_URL = 'https://ai.google.dev/gemini-api/docs';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Common Gemini tool names → display labels. */
function geminiToolLabel(toolName: string | undefined): string {
  switch (toolName) {
    case 'WriteFile':
    case 'write_file':
      return 'Write file';
    case 'Edit':
    case 'replace':
    case 'edit_file':
      return 'Edit file';
    case 'ReadFile':
    case 'read_file':
      return 'Read file';
    case 'ReadFolder':
    case 'list_directory':
    case 'LS':
      return 'List folder';
    case 'FindFiles':
    case 'glob':
    case 'SearchText':
    case 'grep':
      return 'Find files';
    case 'Shell':
    case 'run_shell_command':
    case 'Bash':
      return 'Shell command';
    case 'WebFetch':
    case 'GoogleSearch':
    case 'web_fetch':
      return 'Web access';
    default:
      return toolName ?? 'Tool';
  }
}

function paramDetail(parameters: unknown): string | undefined {
  const record = asRecord(parameters);
  if (!record) return undefined;
  return (
    asString(record.file_path) ??
    asString(record.path) ??
    asString(record.absolute_path) ??
    asString(record.pattern) ??
    asString(record.command)
  );
}

const geminiCliSpec: CliSpec = {
  id: 'gemini-cli',
  binary: 'gemini',

  capabilities(): AgentCapabilities {
    // Headless: weak resume (no reliable session continuation), but partial
    // text deltas; cost is not reported for subscription usage.
    return { resume: false, partialText: true, cost: false };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Gemini CLI not found — install it from ${GEMINI_CLI_INSTALL_URL} and sign in with your Google account.`,
      recoverable: false,
    };
  },

  buildInvocation(req: AgentTurnRequest): CliInvocation {
    const args = [
      '--output-format',
      'stream-json',
      '--approval-mode',
      'auto_edit',
      '-p',
      req.prompt,
    ];
    return { args, keepStdinOpen: false };
  },

  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[] {
    const type = asString(json.type);
    switch (type) {
      case 'init': {
        // Only capture session_id; resume is not reliable in headless mode.
        const sid = asString(json.session_id);
        if (sid !== undefined) state.sessionId = sid;
        return [];
      }
      case 'message': {
        if (asString(json.role) !== 'assistant') return [];
        const content = asString(json.content);
        if (content !== undefined && content.length > 0) return [{ type: 'text-delta', text: content }];
        return [];
      }
      case 'tool_use': {
        const id = asString(json.tool_id) ?? 'tool';
        const label = geminiToolLabel(asString(json.tool_name));
        state.tools.set(id, label);
        const detail = paramDetail(json.parameters);
        return [
          {
            type: 'tool-activity',
            toolCallId: id,
            tool: label,
            phase: 'start',
            ...(detail ? { detail } : {}),
          },
        ];
      }
      case 'tool_result': {
        const id = asString(json.tool_id) ?? 'tool';
        return [
          {
            type: 'tool-activity',
            toolCallId: id,
            tool: state.tools.get(id) ?? 'Tool',
            phase: 'end',
          },
        ];
      }
      case 'error': {
        const message = asString(json.message);
        return [
          {
            type: 'error',
            message: 'Gemini reported an error.',
            recoverable: true,
            ...(message ? { cause: message } : {}),
          },
        ];
      }
      case 'result': {
        const stats = asRecord(json.stats);
        const cost = stats?.total_cost_usd;
        if (typeof cost === 'number') state.costUsd = cost;
        if (asString(json.status) !== 'success' && asString(json.status) !== undefined) {
          state.stopReason = 'error';
        }
        state.done = true;
        return [];
      }
      default:
        return [];
    }
  },
};

/** Creates the gemini-cli adapter (subscription/Google login, official vendor CLI). */
export function createGeminiCliBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(geminiCliSpec, config);
}

export { geminiCliSpec };
