import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, QueueEvents, Worker } from "bullmq";
import type { Job } from "bullmq";
import { connection } from "./connection.js";
import { watchEmailQueue } from "./events.js";
import { closeFlows, processVideo } from "./flow.js";
import { emailQueue, scheduleDigest, sendNormal, sendReceiptLater, sendUrgent, sendWelcomeEmail } from "./queue.js";
import type { EmailJob } from "./queue.js";
import { closeOnSignal, onDeadLetter, startEmailWorker } from "./worker.js";

let worker: Worker<EmailJob> | undefined;

async function until(check: () => boolean | Promise<boolean>, ms = 8_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  assert.fail("condition not met in time");
}

beforeEach(async () => {
  await emailQueue.obliterate({ force: true });
});
afterEach(async () => {
  await worker?.close();
  worker = undefined;
});
after(async () => {
  await emailQueue.close();
  await closeFlows();
});

test("a job is added, processed and returns a value", async () => {
  worker = startEmailWorker(async () => ({ messageId: "m1" }));
  const job = await sendWelcomeEmail(1, "a@b.co");
  await until(async () => (await emailQueue.getJobCounts("completed")).completed === 1);
  const done = await emailQueue.getJob(job.id!);
  assert.deepEqual(done?.returnvalue, { messageId: "m1" });
  assert.equal(done?.progress, 50);
});

test("the same jobId cannot queue twice", async () => {
  await sendWelcomeEmail(2, "a@b.co");
  await sendWelcomeEmail(2, "a@b.co");
  assert.equal((await emailQueue.getJobCounts("waiting")).waiting, 1);
});

test("a throwing job is retried with exponential backoff until it works", async () => {
  const q = new Queue<EmailJob>("email", { connection });
  const attempts: number[] = [];
  worker = startEmailWorker(async () => {
    attempts.push(Date.now());
    if (attempts.length < 3) throw new Error("smtp down");
    return { messageId: "ok" };
  });
  await q.add("receipt", { to: "a@b.co", template: "receipt" }, {
    attempts: 5,
    backoff: { type: "exponential", delay: 100 },
  });
  await until(() => attempts.length === 3);
  await until(async () => (await emailQueue.getJobCounts("completed")).completed === 1);
  assert.ok(attempts[1]! - attempts[0]! >= 95, "first retry waits about 100ms");
  assert.ok(attempts[2]! - attempts[1]! >= 190, "second retry waits about 200ms");
  await q.close();
});

test("UnrecoverableError fails at once, with no retries", async () => {
  let calls = 0;
  worker = startEmailWorker(async () => (calls++, { messageId: "x" }));
  await emailQueue.add("welcome", { to: "not-an-address", template: "welcome" });
  await until(async () => (await emailQueue.getJobCounts("failed")).failed === 1);
  assert.equal(calls, 0);
});

test("a dead-letter alert fires once, only after the last attempt", async () => {
  const alerts: string[] = [];
  let calls = 0;
  worker = startEmailWorker(async () => {
    calls++;
    throw new Error("always");
  });
  onDeadLetter(worker, (job) => alerts.push(job.id!));
  await emailQueue.add("receipt", { to: "a@b.co", template: "receipt" }, {
    attempts: 3,
    backoff: { type: "fixed", delay: 10 },
  });
  await until(() => alerts.length > 0);
  await sleep(150);
  assert.equal(calls, 3);
  assert.equal(alerts.length, 1);
});

test("a dead-letter alert also fires for an unrecoverable failure", async () => {
  const alerts: string[] = [];
  worker = startEmailWorker(async () => ({ messageId: "x" }));
  onDeadLetter(worker, (job) => alerts.push(job.id!));
  await emailQueue.add("welcome", { to: "broken", template: "welcome" });
  await until(() => alerts.length > 0);
  await sleep(100);
  assert.equal(alerts.length, 1);
});

test("a delayed job waits in delayed, then runs", async () => {
  const done: string[] = [];
  await sendReceiptLater("late@b.co", 300);
  assert.equal((await emailQueue.getJobCounts("delayed")).delayed, 1);
  worker = startEmailWorker(async (j) => (done.push(j.to), { messageId: "d" }));
  await sleep(100);
  assert.equal(done.length, 0);
  await until(() => done.length === 1);
});

test("urgent jobs run before normal jobs, when every job has a priority", async () => {
  await sendNormal("normal@b.co");
  await sendUrgent("urgent@b.co");
  const order: string[] = [];
  worker = startEmailWorker(async (j) => (order.push(j.to), { messageId: "p" }));
  await until(() => order.length === 2);
  assert.deepEqual(order, ["urgent@b.co", "normal@b.co"]);
});

test("a job with no priority overtakes a prioritised one", async () => {
  await sendUrgent("urgent@b.co");
  await emailQueue.add("receipt", { to: "plain@b.co", template: "receipt" });
  const order: string[] = [];
  worker = startEmailWorker(async (j) => (order.push(j.to), { messageId: "p" }));
  await until(() => order.length === 2);
  assert.deepEqual(order, ["plain@b.co", "urgent@b.co"]);
});

test("upserting a scheduler twice leaves one schedule", async () => {
  await scheduleDigest();
  await scheduleDigest();
  const all = await emailQueue.getJobSchedulers();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.key, "daily-digest");
  await emailQueue.removeJobScheduler("daily-digest");
});

test("a flow parent runs only after its children", async () => {
  const video = new Queue("video", { connection });
  const resize = new Queue("video-resize", { connection });
  await video.obliterate({ force: true });
  await resize.obliterate({ force: true });
  const seen: string[] = [];
  const w1 = new Worker("video-resize", async (j: Job) => {
    await sleep(40);
    seen.push(`resize-${j.data.height}`);
    return j.data.height;
  }, { connection });
  const w2 = new Worker("video", async (j: Job) => {
    seen.push("publish");
    return Object.values(await j.getChildrenValues()).sort();
  }, { connection });
  const tree = await processVideo("v1");
  await until(() => seen.includes("publish"));
  assert.equal(seen.at(-1), "publish");
  assert.equal(seen.length, 3);
  await until(async () => (await video.getJobCounts("completed")).completed === 1);
  const parent = await video.getJob(tree.job.id!);
  assert.deepEqual(parent?.returnvalue, [1080, 480]);
  await Promise.all([w1.close(), w2.close(), video.close(), resize.close()]);
});

test("QueueEvents hears a job finish from another connection", async () => {
  const events = watchEmailQueue();
  await events.waitUntilReady();
  const heard: string[] = [];
  events.on("completed", ({ jobId }) => heard.push(jobId));
  worker = startEmailWorker(async () => ({ messageId: "e" }));
  const job = await sendWelcomeEmail(9, "a@b.co");
  await until(() => heard.includes(job.id!));
  await events.close();
  assert.ok(events instanceof QueueEvents);
});

test("close waits for the running job to finish", async () => {
  let finished = false;
  worker = startEmailWorker(async () => {
    await sleep(300);
    finished = true;
    return { messageId: "s" };
  });
  await sendWelcomeEmail(3, "a@b.co");
  await until(async () => (await emailQueue.getJobCounts("active")).active === 1);
  await worker.close();
  assert.equal(finished, true);
  assert.equal(typeof closeOnSignal, "function");
});
