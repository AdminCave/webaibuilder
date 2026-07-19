/**
 * Policy evaluation for the adapters (PLAN §4).
 *
 * Default (`DEFAULT_PERMISSION_POLICY` from @webaibuilder/core):
 *   edit-in-site → allow, edit-outside-site → deny, shell/network → prompt.
 *
 * In M2 there is not yet a back-channel for user decisions in the
 * `AgentBackend` contract. A `prompt` is therefore surfaced as a
 * `permission-request` and handled fail-safe (byok: file tools only → never
 * `prompt`; claude-sdk: shell/network → surface + deny). The back-channel
 * arrives with the chat-UI wiring in the desktop.
 */

import type { PermissionPolicy, PermissionRule, PermissionScope } from '@webaibuilder/core';

/** Rule for a scope; if the scope is missing, fail-safe `deny` applies. */
export function ruleFor(policy: PermissionPolicy, scope: PermissionScope): PermissionRule {
  return policy[scope] ?? 'deny';
}
