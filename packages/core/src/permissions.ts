/**
 * Permission-Policy für Agent-Backends (PLAN §4, Agent-Adapter).
 *
 * Default: Auto-Approve für Edits in `<workspace>/site/`, Deny außerhalb,
 * Prompt für Shell und Netz.
 */

/** Wofür ein Backend um Erlaubnis fragt. */
export type PermissionScope = 'edit-in-site' | 'edit-outside-site' | 'shell' | 'network';

/** Wie die App auf eine Anfrage in einem Scope reagiert. */
export type PermissionRule = 'allow' | 'deny' | 'prompt';

/** Regelwerk pro Scope; wird pro Turn an das Backend gereicht. */
export type PermissionPolicy = Readonly<Record<PermissionScope, PermissionRule>>;

/** Nicht verhandelbarer v1-Default (PLAN §4). */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  'edit-in-site': 'allow',
  'edit-outside-site': 'deny',
  shell: 'prompt',
  network: 'prompt',
};

/** Antwort des Nutzers auf ein `permission-request`-Event. */
export interface PermissionDecision {
  requestId: string;
  allow: boolean;
  /** Entscheidung für den Rest des Turns merken. */
  remember?: boolean;
}
