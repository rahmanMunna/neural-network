// #region connection
import type { ConnectionOptions } from "bullmq";

const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

// Pass plain options and BullMQ opens the connections it needs: a Worker uses a
// blocking connection and sets maxRetriesPerRequest to null on it for you.
export const connection: ConnectionOptions = {
  host: url.hostname,
  port: Number(url.port || 6379),
};
// #endregion
