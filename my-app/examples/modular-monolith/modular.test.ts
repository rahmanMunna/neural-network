import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { findBoundaryViolations } from "./boundaries.js";

test("placing an order flows across modules through public APIs and events", async () => {
  const sent: string[] = [];
  const app = createApp((to, text) => sent.push(`${to}: ${text}`));
  assert.deepEqual(await app.orders.place("ada", "kb", 2), { orderId: 1 });
  assert.equal(app.catalog.stockOf("kb"), 1);
  assert.deepEqual(sent, ["ada: Order 1 confirmed"]);
});

test("a failed reservation publishes nothing", async () => {
  const sent: string[] = [];
  const app = createApp((to, text) => sent.push(`${to}: ${text}`));
  assert.equal(await app.orders.place("ada", "kb", 99), null);
  assert.deepEqual(sent, []);
});

test("this project respects its own boundaries", () => {
  assert.deepEqual(findBoundaryViolations(dirname(fileURLToPath(import.meta.url))), []);
});

test("the boundary check catches a private import", () => {
  const root = mkdtempSync(join(tmpdir(), "mods-"));
  mkdirSync(join(root, "orders"));
  mkdirSync(join(root, "catalog"));
  writeFileSync(join(root, "catalog", "store.ts"), "export const x = 1;");
  writeFileSync(join(root, "orders", "index.ts"), 'import { x } from "../catalog/store.js";');
  assert.equal(findBoundaryViolations(root).length, 1);
});
