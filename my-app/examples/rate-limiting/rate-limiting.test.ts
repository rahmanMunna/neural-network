import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { fixedWindow, redis, slidingLog, tokenBucket } from "./limiters.js";
import { rateLimit } from "./plugin.js";

beforeEach(() => redis.flushdb());
after(() => redis.quit());

const burst = async (n: number, one: () => Promise<{ allowed: boolean }>) =>
  (await Promise.all(Array.from({ length: n }, one))).filter((d) => d.allowed).length;

test("all three limiters hold exactly under 200 concurrent requests", async () => {
  assert.equal(await burst(200, () => fixedWindow("f", 50, 5_000)), 50);
  assert.equal(await burst(200, () => slidingLog("s", 50, 5_000)), 50);
  assert.equal(await burst(200, () => tokenBucket("t", 50, 0.001)), 50);
});

test("fixed window allows a double burst across the boundary", async () => {
  // Wait until a fresh window is nearly over, then burst on both sides of it.
  await fixedWindow("edge", 5, 300);
  await sleep(240);
  const late = await burst(4, () => fixedWindow("edge", 5, 300));
  await sleep(80);
  const early = await burst(5, () => fixedWindow("edge", 5, 300));
  assert.equal(late + early + 1, 10, "ten requests passed inside about 100ms");
});

test("sliding log refuses that same burst", async () => {
  await slidingLog("edge", 5, 300);
  await sleep(240);
  const late = await burst(4, () => slidingLog("edge", 5, 300));
  await sleep(80);
  const early = await burst(5, () => slidingLog("edge", 5, 300));
  assert.ok(late + early + 1 <= 6, `got ${late + early + 1}`);
});

test("sliding log reports when to retry", async () => {
  await slidingLog("r", 1, 1_000);
  const denied = await slidingLog("r", 1, 1_000);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 1_000);
});

test("token bucket refills over time", async () => {
  assert.equal(await burst(10, () => tokenBucket("t2", 5, 20)), 5);
  assert.equal((await tokenBucket("t2", 5, 20)).allowed, false);
  await sleep(120);
  assert.equal((await tokenBucket("t2", 5, 20)).allowed, true);
});

test("token bucket never exceeds its capacity after idling", async () => {
  await tokenBucket("t3", 3, 100);
  await sleep(200);
  // Refilling at 100 per second for 200ms would give 20 tokens, but it caps at 3.
  assert.equal((await tokenBucket("t3", 3, 100)).remaining, 2);
});

test("the plugin returns 429 with the standard headers", async () => {
  const app = Fastify();
  rateLimit(app, { capacity: 2, perSecond: 0.1 });
  app.get("/", async () => "ok");
  const a = await app.inject({ url: "/" });
  assert.equal(a.statusCode, 200);
  assert.equal(a.headers["ratelimit-remaining"], "1");
  await app.inject({ url: "/" });
  const c = await app.inject({ url: "/" });
  assert.equal(c.statusCode, 429);
  assert.ok(Number(c.headers["retry-after"]) >= 1);
  await app.close();
});

test("separate clients have separate limits", async () => {
  const app = Fastify();
  rateLimit(app, { capacity: 1, perSecond: 0.1, keyOf: (r) => String(r.headers["x-api-key"]) });
  app.get("/", async () => "ok");
  assert.equal((await app.inject({ url: "/", headers: { "x-api-key": "a" } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/", headers: { "x-api-key": "a" } })).statusCode, 429);
  assert.equal((await app.inject({ url: "/", headers: { "x-api-key": "b" } })).statusCode, 200);
  await app.close();
});
