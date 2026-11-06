// #region client
import { Redis } from "ioredis";

export function createRedis(url = process.env.REDIS_URL ?? "redis://localhost:6379") {
  const client = new Redis(url, {
    // By default ioredis retries a command 20 times. A cache should fail fast,
    // so that an outage slows requests down by milliseconds, not seconds.
    maxRetriesPerRequest: 1,
  });
  // Without a listener, a dropped connection crashes Node with an unhandled error.
  client.on("error", (err) => console.error("redis:", err.message));
  return client;
}

// One shared client for the whole process. ioredis pipelines commands over a
// single connection, so opening one per request would only add latency.
export const redis = createRedis();
// #endregion
