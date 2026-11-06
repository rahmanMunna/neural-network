import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue } from "bullmq";
import pg from "pg";
import { connection } from "../bullmq/connection.js";
import { buildInventory } from "./inventory.js";
import { createOrder, inventoryClient, relayOutbox } from "./orders.js";
import { CircuitBreaker, CircuitOpen } from "./resilience.js";

const inventory = buildInventory(1000);
let url = "";
const pool = new pg.Pool({ connectionString: "postgres://app:app@localhost:5433/app" });
const queue = new Queue("order-events", { connection });

before(async () => {
  url = await inventory.app.listen({ port: 0, host: "127.0.0.1" });
});
beforeEach(async () => {
  Object.assign(inventory.faults, { delayMs: 0, failing: false, calls: 0 });
  await queue.obliterate({ force: true });
  await pool.query(`
    DROP TABLE IF EXISTS outbox; DROP TABLE IF EXISTS orders CASCADE;
    CREATE TABLE orders (id serial PRIMARY KEY, customer text, quantity int);
    CREATE TABLE outbox (id bigserial PRIMARY KEY, topic text NOT NULL, payload text NOT NULL, published_at timestamptz);
  `);
});
after(async () => {
  await inventory.app.close();
  await queue.close();
  await pool.end();
});

test("a service calls another over the network", async () => {
  assert.deepEqual(await inventoryClient(url).reserve(1), { reserved: true });
});

test("a retry with the same key cannot double reserve", async () => {
  const before = inventory.stock();
  const call = () =>
    fetch(`${url}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "same" },
      body: JSON.stringify({ quantity: 5 }),
    });
  await call();
  await call();
  assert.equal(inventory.stock(), before - 5);
});

test("a slow service times out instead of hanging", async () => {
  inventory.faults.delayMs = 2_000;
  const started = Date.now();
  await assert.rejects(inventoryClient(url).reserve(1));
  assert.ok(Date.now() - started < 2_000);
  inventory.faults.delayMs = 0;
});

test("the breaker opens, then fails fast without calling the service", async () => {
  inventory.faults.failing = true;
  const breaker = new CircuitBreaker(3, 200);
  const client = inventoryClient(url, breaker);
  await assert.rejects(client.reserve(1));
  assert.equal(breaker.state, "open");
  const calls = inventory.faults.calls;
  await assert.rejects(client.reserve(1), CircuitOpen);
  assert.equal(inventory.faults.calls, calls);
});

test("the breaker recovers after the cool-down", async () => {
  inventory.faults.failing = true;
  const breaker = new CircuitBreaker(1, 100);
  const client = inventoryClient(url, breaker);
  await assert.rejects(client.reserve(1));
  inventory.faults.failing = false;
  await sleep(120);
  assert.equal(breaker.state, "half-open");
  assert.deepEqual(await client.reserve(1), { reserved: true });
  assert.equal(breaker.state, "closed");
});

test("the outbox publishes each event exactly once to the queue", async () => {
  await createOrder(pool, "ada", 1);
  await createOrder(pool, "lin", 2);
  assert.equal(await relayOutbox(pool, queue), 2);
  assert.equal(await relayOutbox(pool, queue), 0);
  assert.equal((await queue.getJobCounts("waiting")).waiting, 2);
});

test("a rolled back order leaves no event behind", async () => {
  await pool.query("ALTER TABLE outbox ADD CONSTRAINT boom CHECK (topic <> 'order.created')");
  await assert.rejects(createOrder(pool, "ada", 1));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 0);
});

test("concurrent relays never publish the same row twice", async () => {
  for (let i = 0; i < 30; i++) await createOrder(pool, "x", 1);
  const counts = await Promise.all([relayOutbox(pool, queue), relayOutbox(pool, queue), relayOutbox(pool, queue)]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 30);
  assert.equal((await queue.getJobCounts("waiting")).waiting, 30);
});
