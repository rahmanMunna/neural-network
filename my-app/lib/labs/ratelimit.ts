/**
 * The same three algorithms as examples/rate-limiting/limiters.ts, running in
 * the browser so a learner can step through individual requests.
 */

export type Algorithm = "fixed" | "sliding" | "token";

export interface LimitConfig {
  limit: number;
  windowMs: number;
}

export interface Attempt {
  at: number;
  allowed: boolean;
  /** Tokens left after this request. Token bucket only. */
  tokens?: number;
}

export interface Limiter {
  attempt(now: number): boolean;
  /** Current level for the visual: used so far, or tokens remaining. */
  level(now: number): number;
}

export function createLimiter(algorithm: Algorithm, { limit, windowMs }: LimitConfig): Limiter {
  if (algorithm === "fixed") {
    let start = 0;
    let count = 0;
    const roll = (now: number) => {
      const window = Math.floor(now / windowMs) * windowMs;
      if (window !== start) {
        start = window;
        count = 0;
      }
    };
    return {
      attempt(now) {
        roll(now);
        count++;
        return count <= limit;
      },
      level(now) {
        roll(now);
        return Math.min(count, limit);
      },
    };
  }

  if (algorithm === "sliding") {
    const log: number[] = [];
    const prune = (now: number) => {
      while (log.length && log[0]! <= now - windowMs) log.shift();
    };
    return {
      attempt(now) {
        prune(now);
        if (log.length >= limit) return false;
        log.push(now);
        return true;
      },
      level(now) {
        prune(now);
        return log.length;
      },
    };
  }

  let tokens = limit;
  let last = 0;
  const refill = (now: number) => {
    tokens = Math.min(limit, tokens + ((now - last) * limit) / windowMs);
    last = now;
  };
  return {
    attempt(now) {
      refill(now);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    level(now) {
      refill(now);
      return tokens;
    },
  };
}
