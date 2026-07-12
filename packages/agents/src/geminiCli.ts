/**
 * `gemini-cli`-Adapter (Abo/Google-Login, PLAN §4) — spawnt die vom Nutzer
 * installierte offizielle Gemini-CLI im Headless-Modus:
 *
 *   gemini --output-format stream-json --approval-mode auto_edit -p "<prompt>"
 *
 * cwd = `<workspace>/site`. Der JSONL-Strom (`init`, `message`, `tool_use`,
 * `tool_result`, `error`, `result`) wird auf core-`AgentEvent`s gemappt.
 *
 * Compliance (PLAN §3): Explizit über die Gemini-CLI in den ToS erlaubt. Die App
 * reicht keine Credentials weiter — die CLI nutzt den eigenen Google-Login.
 *
 * Hinweis (Capabilities): Headless liefert nur in `init` eine session_id, ein
 * verlässliches Resume gibt es hier nicht → `resume: false` (PLAN-Vorgabe).
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

/** Deep-Link auf die offizielle Installationsanleitung (Onboarding, PLAN §6).
 *  Auf einer erlaubten Vendor-Domain (google.dev), damit der Desktop-Onboarding-
 *  Link ihn öffnen darf. */
export const GEMINI_CLI_INSTALL_URL = 'https://ai.google.dev/gemini-api/docs';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Übliche Gemini-Tool-Namen → deutsche Anzeige-Labels. */
function geminiToolLabel(toolName: string | undefined): string {
  switch (toolName) {
    case 'WriteFile':
    case 'write_file':
      return 'Datei schreiben';
    case 'Edit':
    case 'replace':
    case 'edit_file':
      return 'Datei bearbeiten';
    case 'ReadFile':
    case 'read_file':
      return 'Datei lesen';
    case 'ReadFolder':
    case 'list_directory':
    case 'LS':
      return 'Ordner auflisten';
    case 'FindFiles':
    case 'glob':
    case 'SearchText':
    case 'grep':
      return 'Dateien suchen';
    case 'Shell':
    case 'run_shell_command':
    case 'Bash':
      return 'Shell-Befehl';
    case 'WebFetch':
    case 'GoogleSearch':
    case 'web_fetch':
      return 'Web-Zugriff';
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
    // Headless: schwaches Resume (keine verlässliche Session-Fortsetzung),
    // aber partielle Text-Deltas; Kosten werden für Abo-Nutzung nicht gemeldet.
    return { resume: false, partialText: true, cost: false };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Gemini CLI nicht gefunden — installiere sie von ${GEMINI_CLI_INSTALL_URL} und melde dich mit deinem Google-Konto an.`,
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
        // session_id nur mitnehmen; Resume ist headless nicht verlässlich.
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
            message: 'Gemini hat einen Fehler gemeldet.',
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

/** Erzeugt den gemini-cli-Adapter (Abo/Google-Login, offizielle Vendor-CLI). */
export function createGeminiCliBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(geminiCliSpec, config);
}

export { geminiCliSpec };
