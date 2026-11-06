import { Redis } from "ioredis";
import { redis } from "./client.js";

// #region counter
/** Counts views per day. INCR is atomic, so concurrent calls never lose a count. */
export async function countView(pageId: string, day: string) {
  const key = `views:${pageId}:${day}`;
  // MULTI runs both commands as one unit, so the key can never exist without
  // its expiry, even if this process dies straight after the increment.
  const results = await redis.multi().incr(key).expire(key, 60 * 60 * 24 * 7).exec();
  return Number(results?.[0]?.[1]);
}
// #endregion

// #region leaderboard
/** A sorted set keeps members ordered by score on every write. */
export async function addScore(board: string, player: string, points: number) {
  return Number(await redis.zincrby(board, points, player));
}

export async function topPlayers(board: string, count: number) {
  const flat = await redis.zrevrange(board, 0, count - 1, "WITHSCORES");
  const rows: { player: string; score: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    rows.push({ player: flat[i]!, score: Number(flat[i + 1]) });
  }
  return rows;
}
// #endregion

// #region session
/** A hash stores named fields, so one field can change without rewriting all. */
export async function saveSession(id: string, fields: Record<string, string>) {
  const key = `session:${id}`;
  await redis.multi().hset(key, fields).expire(key, 60 * 30).exec();
}

export function readSession(id: string) {
  return redis.hgetall(`session:${id}`);
}
// #endregion

// #region pubsub
/**
 * A subscribed connection can only run subscribe commands, so it needs its own
 * client. Pub/sub is fire and forget: a subscriber that is offline misses the
 * message. Use BullMQ when every message must be processed.
 */
export function subscribe(channel: string, onMessage: (text: string) => void) {
  const subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  subscriber.on("message", (_channel, text) => onMessage(text));
  return subscriber.subscribe(channel).then(() => subscriber);
}

export const publish = (channel: string, text: string) => redis.publish(channel, text);
// #endregion
