/**
 * Policy-Auswertung für die Adapter (PLAN §4).
 *
 * Default (`DEFAULT_PERMISSION_POLICY` aus @webaibuilder/core):
 *   edit-in-site → allow, edit-outside-site → deny, shell/network → prompt.
 *
 * In M2 gibt es noch keinen Rückkanal für Nutzer-Entscheidungen im
 * `AgentBackend`-Vertrag. Ein `prompt` wird deshalb als `permission-request`
 * sichtbar gemacht und fail-safe behandelt (byok: nur Datei-Tools → nie
 * `prompt`; claude-sdk: Shell/Netz → surface + deny). Der Rückkanal kommt mit
 * der Chat-UI-Verdrahtung im Desktop.
 */

import type { PermissionPolicy, PermissionRule, PermissionScope } from '@webaibuilder/core';

/** Regel für einen Scope; fehlt der Scope, gilt fail-safe `deny`. */
export function ruleFor(policy: PermissionPolicy, scope: PermissionScope): PermissionRule {
  return policy[scope] ?? 'deny';
}
