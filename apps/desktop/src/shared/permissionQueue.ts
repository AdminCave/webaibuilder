/**
 * Zustandsautomat für den Permission-Round-Trip (Main-Prozess).
 *
 * Ablauf (PLAN §4): Das Backend liefert ein `permission-request`-Event; der
 * Main-Prozess leitet es an den Renderer weiter und wartet auf die Antwort des
 * Nutzers (Erlauben/Ablehnen). Trifft sie ein, wird das wartende Promise
 * aufgelöst und die Entscheidung ins Backend zurückgereicht.
 *
 * Rein und headless testbar (kein electron/node) — der IPC-Transport liegt im
 * Aufrufer (appSession.ts).
 */

import type { PermissionDecision } from '@webaibuilder/core';

export class PermissionQueue {
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();

  /** Anzahl offener Anfragen (für Tests/Diagnose). */
  get size(): number {
    return this.pending.size;
  }

  /** true, wenn zu dieser requestId eine Anfrage offen ist. */
  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Registriert eine offene Anfrage und liefert ein Promise, das mit der
   * Nutzerentscheidung aufgelöst wird. Eine doppelte requestId überschreibt die
   * ältere Wartefunktion (defensiv; sollte nicht vorkommen).
   */
  wait(requestId: string): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      this.pending.set(requestId, resolve);
    });
  }

  /**
   * Löst die passende offene Anfrage auf. Liefert true, wenn eine Anfrage
   * gefunden wurde, sonst false (verspätete/unbekannte Antwort).
   */
  resolve(decision: PermissionDecision): boolean {
    const resolver = this.pending.get(decision.requestId);
    if (resolver === undefined) return false;
    this.pending.delete(decision.requestId);
    resolver(decision);
    return true;
  }

  /**
   * Lehnt alle offenen Anfragen ab (z. B. bei Stopp oder Projektwechsel), damit
   * kein wartendes Promise hängen bleibt. `remember` bleibt ungesetzt.
   */
  denyAll(): void {
    for (const [requestId, resolver] of this.pending) {
      resolver({ requestId, allow: false });
    }
    this.pending.clear();
  }
}
