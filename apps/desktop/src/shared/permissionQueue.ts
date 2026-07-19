/**
 * State machine for the permission round-trip (main process).
 *
 * Flow (PLAN §4): the backend emits a `permission-request` event; the main
 * process forwards it to the renderer and waits for the user's answer
 * (allow/deny). When it arrives, the waiting promise is resolved and the decision
 * is handed back to the backend.
 *
 * Pure and headless-testable (no electron/node) — the IPC transport lives in the
 * caller (appSession.ts).
 */

import type { PermissionDecision } from '@webaibuilder/core';

export class PermissionQueue {
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();

  /** Number of open requests (for tests/diagnostics). */
  get size(): number {
    return this.pending.size;
  }

  /** true if a request is open for this requestId. */
  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Registers an open request and returns a promise that resolves with the user's
   * decision. A duplicate requestId overwrites the older waiter (defensive; should
   * not happen).
   */
  wait(requestId: string): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      this.pending.set(requestId, resolve);
    });
  }

  /**
   * Resolves the matching open request. Returns true if a request was found,
   * otherwise false (late/unknown answer).
   */
  resolve(decision: PermissionDecision): boolean {
    const resolver = this.pending.get(decision.requestId);
    if (resolver === undefined) return false;
    this.pending.delete(decision.requestId);
    resolver(decision);
    return true;
  }

  /**
   * Denies all open requests (e.g. on stop or project switch) so no waiting
   * promise is left hanging. `remember` stays unset.
   */
  denyAll(): void {
    for (const [requestId, resolver] of this.pending) {
      resolver({ requestId, allow: false });
    }
    this.pending.clear();
  }
}
