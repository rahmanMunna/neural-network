import { UnrecoverableError, Worker } from "bullmq";
import type { Job } from "bullmq";
import { connection } from "./connection.js";
import type { EmailJob } from "./queue.js";

/** Your real email provider goes here. */
export type Sender = (job: EmailJob) => Promise<{ messageId: string }>;

// #region worker
export function startEmailWorker(send: Sender) {
  return new Worker<EmailJob>(
    "email",
    async (job: Job<EmailJob>) => {
      // A bad address will never succeed, so retrying only wastes attempts.
      if (!job.data.to.includes("@") && job.data.to !== "all") {
        throw new UnrecoverableError(`invalid address: ${job.data.to}`);
      }
      await job.updateProgress(50);
      // Any other throw counts as a failed attempt and is retried with backoff.
      // The return value is stored as job.returnvalue.
      return send(job.data);
    },
    {
      connection,
      // Up to 10 jobs at once in this process. This suits work that waits on
      // the network. CPU-heavy work needs more processes, not more concurrency.
      concurrency: 10,
      // At most 100 jobs per minute across every worker on this queue, to
      // respect the email provider's limit.
      limiter: { max: 100, duration: 60_000 },
    },
  );
}
// #endregion

// #region dead-letter
/**
 * "failed" also fires for attempts that will be retried. Checking the job's
 * state tells a retry apart from the final failure, however it was reached.
 */
export function onDeadLetter(worker: Worker<EmailJob>, alert: (job: Job<EmailJob>) => void) {
  worker.on("failed", async (job) => {
    if (job && (await job.isFailed())) alert(job);
  });
}
// #endregion

// #region shutdown
/** On deploy, stop taking new jobs and let running ones finish. */
export function closeOnSignal(worker: Worker) {
  const stop = async () => {
    await worker.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
// #endregion
