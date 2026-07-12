/**
 * `codex`-Adapter (Abo ODER API-Key — die CLI entscheidet, PLAN §4) — spawnt die
 * vom Nutzer installierte OpenAI-Codex-CLI:
 *
 *   codex exec --json "<prompt>"                    (neuer Turn)
 *   codex exec resume <sessionId> --json "<prompt>" (Session fortsetzen)
 *
 * cwd = `<workspace>/site`. Der JSONL-Strom (`thread.*`, `turn.*`, `item.*`)
 * wird auf core-`AgentEvent`s gemappt. Es gibt kein Token-Streaming: die finale
 * Antwort kommt als ein `item.completed` mit `item.type === "agent_message"`.
 *
 * Compliance (PLAN §3): Die App reicht NICHTS weiter (kein Key, kein Token) — die
 * `codex`-CLI nutzt den Login/Key, den der Nutzer selbst gesetzt hat.
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

/** Deep-Link auf die offizielle Installationsanleitung (Onboarding, PLAN §6). */
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
    // Resume via `codex exec resume <thread_id>`; KEIN Token-Streaming; Codex
    // exec --json meldet nur Token-Usage, keine USD → cost false.
    return { resume: true, partialText: false, cost: false };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Codex CLI nicht gefunden — installiere sie von ${CODEX_INSTALL_URL} und melde dich mit ChatGPT-Abo oder API-Key an.`,
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
            // Finale Antwort nur beim Abschluss als (ganzer) Text ausgeben.
            const text = asString(item.text);
            if (type === 'item.completed' && text !== undefined && text.length > 0) {
              return [{ type: 'text-delta', text }];
            }
            return [];
          }
          case 'reasoning':
            return []; // internes Denken nicht anzeigen
          case 'command_execution':
            return [
              {
                type: 'tool-activity',
                toolCallId: id,
                tool: 'Shell-Befehl',
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
                tool: 'Datei bearbeiten',
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
                tool: asString(item.tool) ?? 'MCP-Tool',
                phase,
                ...(asString(item.server) ? { detail: asString(item.server) } : {}),
              },
            ];
          case 'web_search':
            return [
              {
                type: 'tool-activity',
                toolCallId: id,
                tool: 'Web-Suche',
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
            message: 'Codex hat den Turn abgebrochen.',
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
            message: 'Codex hat einen Fehler gemeldet.',
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

/** Erzeugt den codex-Adapter (Abo oder API-Key, offizielle Vendor-CLI). */
export function createCodexBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(codexSpec, config);
}

export { codexSpec };
