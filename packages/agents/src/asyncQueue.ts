/**
 * Minimal, backpressure-free async queue for merging two concurrent sources
 * (the SDK message loop + the `canUseTool` callback) into a single
 * `AgentEvent` stream.
 */
export class AsyncQueue<T> {
  #items: T[] = [];
  #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.#items.push(item);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    let waiter = this.#waiters.shift();
    while (waiter) {
      waiter({ value: undefined as never, done: true });
      waiter = this.#waiters.shift();
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.#items.length > 0) {
        yield this.#items.shift() as T;
        continue;
      }
      if (this.#closed) return;
      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.#waiters.push(resolve);
      });
      if (result.done) return;
      yield result.value;
    }
  }
}
