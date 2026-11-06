import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "./authz.ts";
import type { Action, Role } from "./authz.ts";
import { createLimiter } from "./ratelimit.ts";

test("every limiter admits exactly the limit in a burst", () => {
  for (const algorithm of ["fixed", "sliding", "token"] as const) {
    const lim = createLimiter(algorithm, { limit: 5, windowMs: 1000 });
    let ok = 0;
    for (let i = 0; i < 20; i++) if (lim.attempt(1500)) ok++;
    assert.equal(ok, 5, algorithm);
  }
});

test("fixed window lets through a double burst across the boundary", () => {
  const lim = createLimiter("fixed", { limit: 5, windowMs: 1000 });
  let ok = 0;
  for (let i = 0; i < 5; i++) if (lim.attempt(950)) ok++;
  for (let i = 0; i < 5; i++) if (lim.attempt(1050)) ok++;
  assert.equal(ok, 10);
});

test("sliding log refuses that burst", () => {
  const lim = createLimiter("sliding", { limit: 5, windowMs: 1000 });
  let ok = 0;
  for (let i = 0; i < 5; i++) if (lim.attempt(950)) ok++;
  for (let i = 0; i < 5; i++) if (lim.attempt(1050)) ok++;
  assert.equal(ok, 5);
});

test("token bucket refills in proportion to time, up to capacity", () => {
  const lim = createLimiter("token", { limit: 10, windowMs: 1000 });
  for (let i = 0; i < 10; i++) lim.attempt(0);
  assert.ok(lim.level(0) < 1);
  assert.ok(Math.abs(lim.level(500) - 5) < 0.01);
  assert.equal(lim.level(60_000), 10);
});

const base = { authenticated: true, role: "editor" as Role, sameTenant: true, isOwner: true, status: "draft" as const, action: "write" as Action };

test("the lab policy matches the tested example", () => {
  assert.equal(evaluate(base).status, 200);
  assert.equal(evaluate({ ...base, authenticated: false }).status, 401);
  assert.equal(evaluate({ ...base, sameTenant: false, role: "admin" }).status, 404);
  assert.equal(evaluate({ ...base, isOwner: false }).status, 403);
  assert.equal(evaluate({ ...base, status: "published" }).status, 403);
  assert.equal(evaluate({ ...base, action: "delete" }).status, 403);
  assert.equal(evaluate({ ...base, role: "admin", action: "delete", isOwner: false }).status, 200);
  assert.equal(evaluate({ ...base, role: "viewer", action: "read", isOwner: false }).status, 403);
  assert.equal(evaluate({ ...base, role: "viewer", action: "read", isOwner: false, status: "published" }).status, 200);
});

test("a failed check ends the evaluation", () => {
  const v = evaluate({ ...base, sameTenant: false });
  assert.equal(v.checks.length, 2);
  assert.equal(v.checks.at(-1)?.passed, false);
});
