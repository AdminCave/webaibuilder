/**
 * Permission policy for agent backends (PLAN §4, agent adapter).
 *
 * Default: auto-approve for edits in `<workspace>/site/`, deny outside,
 * prompt for shell and network.
 */

/** What a backend asks permission for. */
export type PermissionScope = 'edit-in-site' | 'edit-outside-site' | 'shell' | 'network';

/** How the app responds to a request in a scope. */
export type PermissionRule = 'allow' | 'deny' | 'prompt';

/** Rule set per scope; passed to the backend on each turn. */
export type PermissionPolicy = Readonly<Record<PermissionScope, PermissionRule>>;

/** Non-negotiable v1 default (PLAN §4). */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  'edit-in-site': 'allow',
  'edit-outside-site': 'deny',
  shell: 'prompt',
  network: 'prompt',
};

/** The user's response to a `permission-request` event. */
export interface PermissionDecision {
  requestId: string;
  allow: boolean;
  /** Remember the decision for the rest of the turn. */
  remember?: boolean;
}
