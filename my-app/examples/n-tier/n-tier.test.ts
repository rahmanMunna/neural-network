import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { AccountService, InsufficientFunds } from "./business.js";
import type { AccountRepository } from "./business.js";
import { PgAccountRepository } from "./data.js";
import { buildApi } from "./presentation.js";

const pool = new pg.Pool({ connectionString: "postgres://app:app@localhost:5433/app" });
const service = new AccountService(new PgAccountRepository(pool));
const balance = async (id: string) =>
  Number((await pool.query("SELECT cents FROM accounts WHERE id = $1", [id])).rows[0].cents);

beforeEach(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS accounts;
    CREATE TABLE accounts (id text PRIMARY KEY, cents bigint NOT NULL);
    INSERT INTO accounts VALUES ('a', 10000), ('b', 10000);
  `);
});
after(() => pool.end());

test("a transfer moves money through all three tiers", async () => {
  const app = buildApi(service);
  const res = await app.inject({ method: "POST", url: "/transfers", payload: { from: "a", to: "b", cents: 2500 } });
  assert.equal(res.statusCode, 200);
  assert.equal(await balance("a"), 7500);
  assert.equal(await balance("b"), 12500);
  await app.close();
});

test("business rules surface as the right status", async () => {
  const app = buildApi(service);
  const res = await app.inject({ method: "POST", url: "/transfers", payload: { from: "a", to: "b", cents: 999999 } });
  assert.equal(res.statusCode, 409);
  assert.equal(await balance("a"), 10000);
  await app.close();
});

test("bad input never reaches the business tier", async () => {
  const app = buildApi(service);
  const res = await app.inject({ method: "POST", url: "/transfers", payload: { from: "a", cents: -1 } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("the business tier can be tested with no database", async () => {
  const fake: AccountRepository = {
    transaction: (work) =>
      work({ lockBalance: async () => 100, setBalance: async () => {} }),
  };
  await assert.rejects(new AccountService(fake).transfer("a", "b", 500), InsufficientFunds);
});

test("opposing concurrent transfers neither deadlock nor lose money", async () => {
  const jobs = Array.from({ length: 40 }, (_, i) =>
    i % 2 ? service.transfer("a", "b", 10) : service.transfer("b", "a", 10),
  );
  await Promise.all(jobs);
  assert.equal((await balance("a")) + (await balance("b")), 20000);
});

test("overspending under concurrency is impossible", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.transfer("a", "b", 1000)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
  assert.equal(await balance("a"), 0);
});
