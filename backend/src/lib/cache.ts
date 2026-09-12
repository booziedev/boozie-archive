/**
 * Small in-memory caches for things fetched from other people's servers.
 *
 * Every one of those calls is slow, rate-limited by somebody else, and asked
 * for repeatedly — the same searches recur constantly, and a page of results
 * asks for the same artwork as the page before it. Holding the answers for a
 * few minutes is the difference between a responsive picker and one that waits
 * on a round trip per keystroke.
 *
 * Bounded on purpose. An unbounded Map keyed on a search term is a slow leak
 * that only shows up weeks later on a machine with a gigabyte of RAM.
 */

export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 200,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T) {
    // Map iterates in insertion order, so the first key is the oldest write.
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string) {
    this.entries.delete(key);
  }
}

/**
 * Collapses concurrent identical work into one operation.
 *
 * Ten tiles on a profile pointing at the same artist, or five people searching
 * the same band at once, should be one upstream request rather than ten. The
 * promise is registered before the work starts and removed when it settles, so
 * a failure is retried next time rather than cached.
 */
export class InFlight<T> {
  private pending = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const promise = work().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
