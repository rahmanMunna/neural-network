import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { cached, cachedOnce } from "./cache.js";
import { createRedis, redis } from "./client.js";
import { addScore, countView, publish, readSession, saveSession, subscribe, topPlayers } from "./patterns.js";
import { userService } from "./users.js";

beforeEach(() => redis.flushdb());
after(() => redis.quit());

test("cache-aside loads once, then serves from Redis", async () => {
  let loads = 0;
  const load = async () => (loads++, { id: 1 });
  assert.deepEqual(await cached("k", 60, load), { id: 1 });
  assert.deepEqual(await cached("k", 60, load), { id: 1 });
  assert.equal(loads, 1);
  const ttl = await redis.ttl("k");
  assert.ok(ttl >= 54 && ttl <= 66, `ttl ${ttl} should be within the jitter range`);
});

test("a missing row is cached too, with a short ttl", async () => {
  let loads = 0;
  const load = async () => (loads++, null);
  assert.equal(await cached("missing", 3600, load), null);
  assert.equal(await cached("missing", 3600, load), null);
  assert.equal(loads, 1);
  assert.ok((await redis.ttl("missing")) <= 30);
});

test("a stampede of 100 callers triggers one rebuild", async () => {
  let loads = 0;
  const load = async () => {
    loads++;
    await sleep(120);
    return { value: 42 };
  };
  const all = await Promise.all(Array.from({ length: 100 }, () => cachedOnce("hot", 60, load)));
  assert.equal(loads, 1);
  assert.ok(all.every((v) => v?.value === 42));
  assert.equal(await redis.get("lock:hot"), null, "lock must be released");
});

test("a write invalidates the cached value", async () => {
  const row = { id: 7, name: "Ada" };
  const service = userService({
    find: async () => ({ ...row }),
    rename: async (_id, name) => ((row.name = name), { ...row }),
  });
  assert.equal((await service.get(7))?.name, "Ada");
  await service.rename(7, "Grace");
  assert.equal((await service.get(7))?.name, "Grace");
});

test("counters survive concurrency and always expire", async () => {
  await Promise.all(Array.from({ length: 200 }, () => countView("home", "2026-11-07")));
  assert.equal(await redis.get("views:home:2026-11-07"), "200");
  assert.ok((await redis.ttl("views:home:2026-11-07")) > 0);
});

test("the leaderboard stays sorted", async () => {
  await addScore("b", "ada", 30);
  await addScore("b", "lin", 50);
  await addScore("b", "ada", 40);
  assert.deepEqual(await topPlayers("b", 2), [
    { player: "ada", score: 70 },
    { player: "lin", score: 50 },
  ]);
});

test("sessions are stored as hashes and expire", async () => {
  await saveSession("s1", { userId: "9", plan: "pro" });
  assert.deepEqual(await readSession("s1"), { userId: "9", plan: "pro" });
  assert.ok((await redis.ttl("session:s1")) > 0);
});

test("pub/sub delivers to subscribers that are online", async () => {
  const got: string[] = [];
  const sub = await subscribe("news", (t) => got.push(t));
  assert.equal(await publish("news", "hello"), 1);
  await sleep(50);
  assert.deepEqual(got, ["hello"]);
  await sub.quit();
});

test("a dead Redis fails fast instead of hanging", async () => {
  const dead = createRedis("redis://localhost:6399");
  const started = Date.now();
  await assert.rejects(dead.get("x"));
  assert.ok(Date.now() - started < 2_000, "commands must not wait long");
  dead.disconnect();
});

test("when Redis is unreachable, requests still reach the database", async () => {
  const service = userService({
    find: async () => ({ id: 1, name: "Ada" }),
    rename: async () => ({ id: 1, name: "Grace" }),
  });
  redis.disconnect();
  try {
    assert.equal((await cached("x", 60, async () => "from db")), "from db");
    assert.equal((await service.get(1))?.name, "Ada");
    assert.equal((await service.rename(1, "Grace"))?.name, "Grace");
  } finally {
    await redis.connect();
  }
});
