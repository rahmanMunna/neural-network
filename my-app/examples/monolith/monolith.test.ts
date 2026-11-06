import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import pg from "pg";
import { buildShop, checkout, OutOfStock } from "./shop.js";

const pool = new pg.Pool({ connectionString: "postgres://app:app@localhost:5433/app" });

beforeEach(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS orders CASCADE; DROP TABLE IF EXISTS products;
    CREATE TABLE products (sku text PRIMARY KEY, stock int NOT NULL, price_cents int NOT NULL);
    CREATE TABLE orders (id serial PRIMARY KEY, customer text, sku text, quantity int, total_cents int);
    CREATE TABLE payments (id serial PRIMARY KEY, order_id int NOT NULL REFERENCES orders, cents int NOT NULL CHECK (cents < 100000));
    INSERT INTO products VALUES ('kb', 5, 2000), ('car', 5, 900000);
  `);
});
after(() => pool.end());

test("checkout writes stock, order and payment together", async () => {
  const app = buildShop(pool);
  const res = await app.inject({ method: "POST", url: "/checkout", payload: { sku: "kb", quantity: 2, customer: "ada" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().total, 4000);
  const stock = (await pool.query("SELECT stock FROM products WHERE sku='kb'")).rows[0].stock;
  assert.equal(stock, 3);
  await app.close();
});

test("a failing last step undoes every earlier step", async () => {
  // The payments CHECK rejects this total after stock and order already ran.
  await assert.rejects(checkout(pool, "car", 1, "ada"));
  assert.equal((await pool.query("SELECT stock FROM products WHERE sku='car'")).rows[0].stock, 5);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 0);
});

test("stock can never go negative under concurrency", async () => {
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => checkout(pool, "kb", 1, "x")));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason instanceof OutOfStock));
});
