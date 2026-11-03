/**
 * FIFO mutex for serializing async critical sections inside ONE Node.js process.
 * It does not provide any guarantee across processes.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  /** Runs `task` after every previously queued task has settled. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
