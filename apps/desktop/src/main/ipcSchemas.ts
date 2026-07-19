/**
 * Laufzeit-Validierung der IPC-Argumente (Defense-in-Depth, AP4): Die Sender-
 * Validierung (security.ts) stellt sicher, WER ruft; diese Schemas stellen
 * sicher, WAS ankommt — sollte der sandboxed Renderer je kompromittiert sein,
 * erreichen fehlgeformte Nutzlasten die Services/Registry nicht mehr.
 *
 * Die Schemas beschreiben das jeweilige Argument-TUPEL eines Kanals. Kanäle
 * ohne Eintrag (argumentlose wie `chat:interrupt`) laufen unvalidiert durch —
 * dort gibt es nichts zu prüfen. Nur node-frei (zod) → headless testbar.
 */

import { z } from 'zod';

import { IpcChannels } from '@webaibuilder/core';

import { ACTIVE_BACKEND_IDS, BYOK_PROVIDERS } from '../shared/settings';
import { DesktopIpcChannels } from '../shared/channels';

const id = z.string().min(1);
const backendId = z.enum(ACTIVE_BACKEND_IDS as [string, ...string[]]);

/** Deploy-Ziel-Eingabe (Secrets fließen nur in diese Richtung). */
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
 * Argument-Tupel-Schema pro Kanal. Bewusst als String-Map (nicht generisch an
 * die IpcInvokeMap gebunden): die Compile-Zeit-Typen sichern die Handler, die
 * Schemas sichern die Laufzeit — Drift fällt in ipcSchemas.test.ts auf.
 */
export const IPC_ARG_SCHEMAS: Readonly<Record<string, z.ZodType<unknown>>> = {
  // --- core: Projekte & Vorlagen ---
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

  // --- Session / Chat / Checkpoints / Einstellungen ---
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
 * Prüft die Argumente eines Kanals. `null` = gültig (oder kein Schema);
 * sonst eine kompakte Fehlerbeschreibung fürs Log.
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
