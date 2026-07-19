/**
 * Small event bus for PreviewEvent: synchronous listener API plus
 * async iteration (`for await (const event of handle.events)`).
 */

import type { PreviewEvent, PreviewEventListener, PreviewEventStream } from './types';

export class PreviewEventBus implements PreviewEventStream {
  private readonly listeners = new Set<PreviewEventListener>();
  private readonly endSignals = new Set<() => void>();
  private closed = false;

  emit(event: PreviewEvent): void {
    if (this.closed) return;
    for (const listener of [...this.listeners]) listener(event);
  }

  on(listener: PreviewEventListener): () => void {
    this.listeners.add(listener);
    return () => this.off(listener);
  }

  off(listener: PreviewEventListener): void {
    this.listeners.delete(listener);
  }

  /** Ends all running iterations; further events are discarded. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const signal of [...this.endSignals]) signal();
  }

  [Symbol.asyncIterator](): AsyncIterator<PreviewEvent> {
    const queue: PreviewEvent[] = [];
    let ended = this.closed;
    let wake: (() => void) | undefined;

    const unsubscribe = this.on((event) => {
      queue.push(event);
      wake?.();
    });
    const end = (): void => {
      ended = true;
      wake?.();
    };
    this.endSignals.add(end);

    const finish = (): void => {
      unsubscribe();
      this.endSignals.delete(end);
    };

    return {
      next: async (): Promise<IteratorResult<PreviewEvent>> => {
        for (;;) {
          const event = queue.shift();
          if (event !== undefined) return { value: event, done: false };
          if (ended) {
            finish();
            return { value: undefined, done: true };
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      },
      return: (): Promise<IteratorResult<PreviewEvent>> => {
        finish();
        end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
