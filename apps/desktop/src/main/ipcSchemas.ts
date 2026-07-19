/**
 * Runtime validation of the IPC arguments (defense-in-depth, AP4): sender
 * validation (security.ts) ensures WHO is calling; these schemas ensure WHAT
 * arrives — should the sandboxed renderer ever be compromised, malformed
 * payloads no longer reach the services/registry.
 *
 * The schemas describe the argument TUPLE of each channel. Channels without an
 * entry (argument-less ones like `chat:interrupt`) pass through unvalidated —
 * there is nothing to check there. Node-free (zod) only → headless testable.
 */

import { z } from 'zod';

import { IpcChannels } from '@webaibuilder/core';

import { ACTIVE_BACKEND_IDS, BYOK_PROVIDERS } from '../shared/settings';
import { DesktopIpcChannels } from '../shared/channels';

const id = z.string().min(1);
const backendId = z.enum(ACTIVE_BACKEND_IDS as [string, ...string[]]);

/** Deploy-target input (secrets flow only in this direction). */
const deployTargetInput = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    protocol: z.enum(['sftp', 'ftp', 'ftps']),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.string(),
    remotePath: z.string().min(1),
    password: z.string().optional(),
    passphrase: z.string().optional(),
  })
  .strict();

const agentSettingsInput = z
  .object({
    backendId: backendId.optional(),
    provider: z.enum(BYOK_PROVIDERS as [string, ...string[]]).optional(),
    model: z.string().optional(),
    apiKey: z.string().nullable().optional(),
  })
  .strict();

const rendererErrorReport = z
  .object({
    kind: z.enum(['error', 'unhandledrejection']),
    message: z.string(),
    stack: z.string().optional(),
    source: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
  })
  .strict();

/**
 * Argument-tuple schema per channel. Deliberately a string map (not generically
 * bound to the IpcInvokeMap): the compile-time types secure the handlers, the
 * schemas secure the runtime — drift is caught in ipcSchemas.test.ts.
 */
export const IPC_ARG_SCHEMAS: Readonly<Record<string, z.ZodType<unknown>>> = {
  // --- core: projects & templates ---
  [IpcChannels.projectsGet]: z.tuple([id]),
  [IpcChannels.projectsCreate]: z.tuple([
    z.object({ name: z.string().min(1), templateId: z.string().min(1) }).strict(),
  ]),
  [IpcChannels.projectsUpdate]: z.tuple([
    id,
    z
      .object({
        name: z.string().min(1).optional(),
        lastBackend: backendId.optional(),
        deployTargets: z.array(z.unknown()).optional(),
      })
      .strict(),
  ]),
  [IpcChannels.projectsDelete]: z.tuple([id]),

  // --- session / chat / checkpoints / settings ---
  [DesktopIpcChannels.sessionOpen]: z.tuple([id]),
  [DesktopIpcChannels.chatSend]: z.tuple([
    z.object({ prompt: z.string().min(1), runId: z.string() }).strict(),
  ]),
  [DesktopIpcChannels.chatPermission]: z.tuple([
    z
      .object({ requestId: z.string().min(1), allow: z.boolean(), remember: z.boolean().optional() })
      .strict(),
  ]),
  [DesktopIpcChannels.checkpointsRestore]: z.tuple([id]),
  [DesktopIpcChannels.settingsSet]: z.tuple([agentSettingsInput]),

  // --- Deploy ---
  [DesktopIpcChannels.deployTargetsList]: z.tuple([id]),
  [DesktopIpcChannels.deployTargetsSave]: z.tuple([id, deployTargetInput]),
  [DesktopIpcChannels.deployTargetsDelete]: z.tuple([id, id]),
  [DesktopIpcChannels.deployTest]: z.tuple([id, id]),
  [DesktopIpcChannels.deployRun]: z.tuple([id, id, z.string()]),
  [DesktopIpcChannels.deployRollback]: z.tuple([id, id, id, z.string()]),
  [DesktopIpcChannels.deployDrift]: z.tuple([id, id]),
  [DesktopIpcChannels.deployHistory]: z.tuple([id]),

  // --- Backends / Onboarding / Logs ---
  [DesktopIpcChannels.backendsAck]: z.tuple([backendId]),
  [DesktopIpcChannels.backendsOpenHint]: z.tuple([z.string().url()]),
  [DesktopIpcChannels.onboardingSet]: z.tuple([
    z
      .object({ hasOnboarded: z.boolean().optional(), completedAt: z.string().optional() })
      .strict(),
  ]),
  [DesktopIpcChannels.logsReport]: z.tuple([rendererErrorReport]),
  [DesktopIpcChannels.logsTail]: z.tuple([z.number().int().min(1).max(5000)]),
};

/**
 * Validates a channel's arguments. `null` = valid (or no schema); otherwise a
 * compact error description for the log.
 */
export function validateIpcArgs(channel: string, args: readonly unknown[]): string | null {
  const schema = IPC_ARG_SCHEMAS[channel];
  if (schema === undefined) return null;
  const result = schema.safeParse(args);
  if (result.success) return null;
  return result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
