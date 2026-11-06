import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { redis } from "./client.js";

// #region cache-aside
/** Spreads expiry over +/-10%, so keys cached together do not expire together. */
function jitter(ttlSeconds: number): number {
  const spread = ttlSeconds * 0.1;
  return Math.max(1, Math.round(ttlSeconds - spread + Math.random() * spread * 2));
}

/**
 * Cache-aside: try Redis, fall back to the source, store the result.
 * `null` is cached too, briefly, so a missing row cannot hammer the database.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const hit = await safely(() => redis.get(key));
  if (hit) return JSON.parse(hit) as T;

  const value = await load();
  const ttl = value === null ? Math.min(30, ttlSeconds) : jitter(ttlSeconds);
  await safely(() => redis.set(key, JSON.stringify(value), "EX", ttl));
  return value;
}

/**
 * A cache is an optimisation, so losing it must not take the site down. If
 * Redis is unreachable, every request simply goes to the database. Watch out:
 * that database now takes the full load, so it needs its own limits.
 */
export async function safely<T>(command: () => Promise<T>): Promise<T | null> {
  try {
    return await command();
  } catch (err) {
    console.error("cache unavailable:", (err as Error).message);
    return null;
  }
}
// #endregion

// #region lock
// Deleting a lock is only safe if we still own it, so compare and delete must
// be one atomic step. Lua scripts run without any other command in between.
const RELEASE = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

/**
 * Stampede protection. When a popular key expires, only the caller holding the
 * lock rebuilds it. Everyone else waits briefly for that result.
 */
export async function cachedOnce<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const hit = await safely(() => redis.get(key));
  if (hit) return JSON.parse(hit) as T;

  const lockKey = `lock:${key}`;
  const token = randomUUID();
  // NX: only if absent. PX: the lock frees itself if this process dies.
  const won = await safely(() => redis.set(lockKey, token, "PX", 5_000, "NX"));

  if (won === "OK") {
    try {
      return await cached(key, ttlSeconds, load);
    } finally {
      await safely(() => redis.eval(RELEASE, 1, lockKey, token));
    }
  }
  // Redis is down, so nobody holds a lock worth waiting for.
  if (won === null && redis.status !== "ready") return load();

  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(50);
    const value = await safely(() => redis.get(key));
    if (value) return JSON.parse(value) as T;
  }
  // The rebuild is taking too long. Serving the request beats failing it.
  return load();
}
// #endregion
