/**
 * Per-game serialized async task runner (ADR A14). Even though Node is
 * single-threaded, decode→validate→apply→persist→fan-out spans `await`s, so two
 * commands for the same game could interleave. Funnelling every mutation for a
 * game through this mutex makes each command atomic and prevents double-apply.
 */
export class CommandQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(() => task());
    // Keep the chain alive regardless of whether a task resolves or rejects, so one
    // failed command never wedges the queue.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
