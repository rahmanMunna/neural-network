import { Queue } from "bullmq";
import { connection } from "./connection.js";

// #region queue
export interface EmailJob {
  to: string;
  template: "welcome" | "receipt";
}

export const emailQueue = new Queue<EmailJob>("email", {
  connection,
  defaultJobOptions: {
    // Try 5 times, waiting 1s, 2s, 4s, 8s between attempts.
    attempts: 5,
    backoff: { type: "exponential", delay: 1_000 },
    // Finished jobs stay in Redis until removed, so always set a limit.
    removeOnComplete: { age: 60 * 60, count: 1_000 },
    // Keep failures longer: they are what you debug.
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});
// #endregion

// #region produce
/**
 * Adding a job only writes to Redis, so it takes about a millisecond. The
 * jobId makes this idempotent: the same signup cannot queue a second email.
 */
export async function sendWelcomeEmail(userId: number, to: string) {
  return emailQueue.add("welcome", { to, template: "welcome" }, { jobId: `welcome-${userId}` });
}
// #endregion

// #region delayed
/** The job waits in the delayed set, then moves to waiting by itself. */
export function sendReceiptLater(to: string, delayMs: number) {
  return emailQueue.add("receipt", { to, template: "receipt" }, { delay: delayMs });
}

/**
 * Lower numbers run first, but a job with no priority runs ahead of every
 * prioritised job. So once you use priorities, give every job one.
 */
export const priority = { urgent: 1, normal: 10 };

export function sendUrgent(to: string) {
  return emailQueue.add("receipt", { to, template: "receipt" }, { priority: priority.urgent });
}

export function sendNormal(to: string) {
  return emailQueue.add("receipt", { to, template: "receipt" }, { priority: priority.normal });
}
// #endregion

// #region schedule
/**
 * Job schedulers replaced repeatable jobs in BullMQ 6. Upserting by id is safe
 * on every boot: running this twice still leaves exactly one schedule.
 */
export function scheduleDigest() {
  return emailQueue.upsertJobScheduler(
    "daily-digest",
    { pattern: "0 0 8 * * *", tz: "UTC" },
    { name: "digest", data: { to: "all", template: "receipt" } },
  );
}
// #endregion
