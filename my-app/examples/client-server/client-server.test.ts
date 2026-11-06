import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildServer } from "./server.js";

const a = buildServer("api-1");
const b = buildServer("api-2");
const root = dirname(dirname(fileURLToPath(import.meta.url)));

before(async () => {
  await a.listen({ port: 3001, host: "0.0.0.0" });
  await b.listen({ port: 3002, host: "0.0.0.0" });
  execFileSync("docker", ["compose", "up", "-d", "nginx"], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://localhost:8088/healthz")).ok) return;
    } catch {}
    await sleep(250);
  }
  assert.fail("nginx did not become ready");
});

after(async () => {
  execFileSync("docker", ["compose", "stop", "nginx"], { cwd: root, stdio: "ignore" });
  await Promise.all([a.close(), b.close()]);
});

test("the reverse proxy balances between instances", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const body = (await (await fetch("http://localhost:8088/api/products/7")).json()) as { servedBy: string };
    seen.add(body.servedBy);
  }
  assert.deepEqual([...seen].sort(), ["api-1", "api-2"]);
});

test("a client cannot forge its address through X-Forwarded-For", async () => {
  const body = (await (await fetch("http://localhost:8088/api/products/7", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  })).json()) as { clientIp: string };
  assert.notEqual(body.clientIp, "203.0.113.9");
  assert.ok(body.clientIp.length > 0);
});

test("invalid input is rejected with 400", async () => {
  assert.equal((await fetch("http://localhost:8088/api/products/abc")).status, 400);
});

test("oversized bodies stop at the proxy", async () => {
  const res = await fetch("http://localhost:8088/api/products/7", {
    method: "POST",
    body: "x".repeat(2 * 1024 * 1024),
  });
  assert.equal(res.status, 413);
});

test("the proxy returns 502 when no instance is reachable", async () => {
  await Promise.all([a.close(), b.close()]);
  const res = await fetch("http://localhost:8088/api/products/7");
  assert.equal(res.status, 502);
});
