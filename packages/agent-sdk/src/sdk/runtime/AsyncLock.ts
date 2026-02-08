export class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    const unlock = this.enqueue();
    await unlock.start;
    try {
      return await fn();
    } finally {
      unlock.finish();
    }
  }

  private enqueue(): { start: Promise<void>; finish: () => void } {
    let release: () => void = () => {};
    const start = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.queue;
    this.queue = previous.then(() => start);

    return {
      start: previous,
      finish: release,
    };
  }
}
