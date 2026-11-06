// #region breaker
export class CircuitOpen extends Error {}

/**
 * A circuit breaker stops calling a service that keeps failing. Callers fail
 * instantly instead of queueing up on timeouts, and the service gets room to
 * recover. After the cool-down one trial call decides what happens next.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 3,
    private readonly coolDownMs = 5_000,
  ) {}

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return Date.now() - this.openedAt >= this.coolDownMs ? "half-open" : "open";
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.state === "open") throw new CircuitOpen("circuit is open");
    try {
      const result = await call();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.threshold) this.openedAt = Date.now();
      throw err;
    }
  }
}
// #endregion

// #region retry
/**
 * Retries with exponential backoff and jitter. Jitter stops every client from
 * retrying at the same moment. Only retry calls that are safe to repeat.
 */
export async function withRetry<T>(call: () => Promise<T>, attempts = 3, baseMs = 100): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= attempts || err instanceof CircuitOpen) throw err;
      const delay = baseMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay / 2 + Math.random() * (delay / 2)));
    }
  }
}
// #endregion
