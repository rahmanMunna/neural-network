import { QueueEvents } from "bullmq";
import { connection } from "./connection.js";

// #region events
/**
 * QueueEvents listens from any process, so the API can react to jobs that ran
 * on a worker elsewhere. It reads a Redis stream, so it needs its own connection.
 */
export function watchEmailQueue() {
  const events = new QueueEvents("email", { connection });
  events.on("completed", ({ jobId }) => console.log("sent", jobId));
  events.on("failed", ({ jobId, failedReason }) => console.warn("failed", jobId, failedReason));
  return events;
}
// #endregion
