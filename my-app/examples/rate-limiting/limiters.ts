import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

export interface Decision {
  allowed: boolean;
  /** Requests left after this one. */
  remaining: number;
  /** Milliseconds until a request would succeed. Zero when allowed. */
  retryAfterMs: number;
}

// #region fixed-window
/**
 * Fixed window: count requests per clock window. It is cheap, but a client can
 * send a full burst at the end of one window and another at the start of the
 * next, so up to double the limit can pass in a short span.
 */
const FIXED_WINDOW = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
  return { count, redis.call("PTTL", KEYS[1]) }
`;

export async function fixedWindow(key: string, limit: number, windowMs: number): Promise<Decision> {
  const [count, ttl] = (await redis.eval(FIXED_WINDOW, 1, key, windowMs)) as [number, number];
  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count), retryAfterMs: allowed ? 0 : ttl };
}
// #endregion

// #region sliding-log
/**
 * Sliding log: remember the time of every request in a sorted set. It is exact,
 * with no boundary burst, but memory grows with the limit.
 */
const SLIDING_LOG = `
  local now = redis.call("TIME")
  local nowMs = now[1] * 1000 + math.floor(now[2] / 1000)
  local windowMs = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, nowMs - windowMs)
  local count = redis.call("ZCARD", KEYS[1])
  if count < limit then
    redis.call("ZADD", KEYS[1], nowMs, ARGV[3])
    redis.call("PEXPIRE", KEYS[1], windowMs)
    return { 1, limit - count - 1, 0 }
  end
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  return { 0, 0, tonumber(oldest[2]) + windowMs - nowMs }
`;

export async function slidingLog(key: string, limit: number, windowMs: number): Promise<Decision> {
  const [allowed, remaining, retryAfterMs] = (await redis.eval(
    SLIDING_LOG, 1, key, windowMs, limit, randomUUID(),
  )) as [number, number, number];
  return { allowed: allowed === 1, remaining, retryAfterMs };
}
// #endregion

// #region token-bucket
/**
 * Token bucket: tokens refill steadily and each request spends one. It allows
 * short bursts up to the capacity while holding the long-run average. Refill is
 * computed on read, so idle clients cost nothing.
 */
const TOKEN_BUCKET = `
  local now = redis.call("TIME")
  local nowMs = now[1] * 1000 + math.floor(now[2] / 1000)
  local capacity = tonumber(ARGV[1])
  local perSecond = tonumber(ARGV[2])

  local state = redis.call("HMGET", KEYS[1], "tokens", "ts")
  local tokens = tonumber(state[1]) or capacity
  local ts = tonumber(state[2]) or nowMs

  tokens = math.min(capacity, tokens + (nowMs - ts) / 1000 * perSecond)

  local allowed = 0
  local retry = 0
  if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
  else
    retry = math.ceil((1 - tokens) / perSecond * 1000)
  end

  redis.call("HSET", KEYS[1], "tokens", tostring(tokens), "ts", nowMs)
  redis.call("PEXPIRE", KEYS[1], math.ceil(capacity / perSecond * 1000) + 1000)
  return { allowed, math.floor(tokens), retry }
`;

export async function tokenBucket(key: string, capacity: number, perSecond: number): Promise<Decision> {
  const [allowed, remaining, retryAfterMs] = (await redis.eval(
    TOKEN_BUCKET, 1, key, capacity, perSecond,
  )) as [number, number, number];
  return { allowed: allowed === 1, remaining, retryAfterMs };
}
// #endregion
