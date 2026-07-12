/**
 * `grok-cli`-Adapter (experimentell, PLAN §4 + §3) — spawnt die vom Nutzer
 * installierte offizielle Grok-Build-CLI im Headless-Modus:
 *
 *   grok -p "<prompt>" --output-format streaming-json --no-auto-update
 *
 * cwd = `<workspace>/site`. Grok gibt ohne `--output-format` menschenlesbaren
 * Text aus; `streaming-json` liefert JSONL-Events (ACP-nah: `session/update`
 * mit `agent_message_chunk`/`tool_call`). Das exakte Schema ist am wenigsten
 * dokumentiert — der Mapper ist bewusst tolerant und deckt mehrere Formen ab.
 *
 * Compliance (PLAN §3): Offiziell; eigene CLI zu spawnen ist toleriert. Die App
 * reicht keine Credentials weiter — die CLI nutzt den eigenen SuperGrok-Login.
 * Als "experimentell" markiert (PLAN-Statuszeile xAI).
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

/** Deep-Link auf die offizielle Installationsanleitung (Onboarding, PLAN §6).
 *  Auf einer erlaubten Vendor-Domain (x.ai). */
export const GROK_CLI_INSTALL_URL = 'https://docs.x.ai/docs/overview';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Text aus einem ACP-`content`-Feld ziehen (String oder `{type:'text',text}`). */
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

/** ACP-`session/update`-Notification → AgentEvents. */
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
      return []; // internes Denken nicht anzeigen
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
    // Experimentell: Text-Streaming ja; Resume/Kosten nicht verlässlich.
    return { resume: false, partialText: true, cost: false };
  },

  notFound(): AgentErrorEvent {
    return {
      type: 'error',
      message: `Grok Build CLI nicht gefunden — installiere sie von ${GROK_CLI_INSTALL_URL} und melde dich mit deinem SuperGrok-Konto an (experimentell).`,
      recoverable: false,
    };
  },

  buildInvocation(req: AgentTurnRequest): CliInvocation {
    // `-p` = Headless-Einzelprompt; streaming-json macht die Ausgabe parsebar.
    const args = ['-p', req.prompt, '--output-format', 'streaming-json', '--no-auto-update'];
    return { args, keepStdinOpen: false };
  },

  mapLine(json: Record<string, unknown>, state: TurnState): AgentEvent[] {
    // 1) ACP-JSON-RPC-Notification (`method: "session/update"`).
    if (asString(json.method) === 'session/update') {
      const params = asRecord(json.params);
      const update = asRecord(params?.update);
      if (update) return mapSessionUpdate(update, state);
      return [];
    }
    // 2) Direkt eingebettetes `update`-Objekt.
    const directUpdate = asRecord(json.update);
    if (directUpdate) return mapSessionUpdate(directUpdate, state);

    // 3) Generische, flache Formen (defensiv gegen Schema-Drift).
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
            message: 'Grok hat einen Fehler gemeldet.',
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

/** Erzeugt den grok-cli-Adapter (experimentell, offizielle Vendor-CLI). */
export function createGrokCliBackend(config: CliBackendConfig = {}): AgentBackend {
  return createCliBackend(grokCliSpec, config);
}

export { grokCliSpec };
