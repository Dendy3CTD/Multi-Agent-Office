/**
 * FIFO promise queue. Tasks run one after another in call order; a failing task
 * does not block the queue. Callers handle their own task rejections.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolves once every task enqueued so far has settled. */
  idle(): Promise<void> {
    return this.tail;
  }
}
