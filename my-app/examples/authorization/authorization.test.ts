import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { redis, signAccessToken } from "../authentication/tokens.js";
import { buildDocsApi } from "./api.js";
import { can, hasPermission } from "./policy.js";
import type { Actor, Doc, Role } from "./policy.js";

const doc: Doc = { id: "d1", tenant: "acme", ownerId: "u1", status: "draft" };
const actor = (id: string, role: Role, tenant = "acme"): Actor => ({ id, role, tenant });

let docs: Map<string, Doc>;
beforeEach(() => {
  docs = new Map([["d1", { ...doc }], ["pub", { ...doc, id: "pub", status: "published" }]]);
});
after(() => redis.quit());

const call = async (method: "GET" | "PUT" | "DELETE", url: string, sub?: string, role?: Role, tenant = "acme") => {
  const app = buildDocsApi(docs);
  const headers = sub
    ? { authorization: `Bearer ${await signAccessToken({ sub, role: role!, tenant })}` }
    : undefined;
  const res = await app.inject({ method, url, headers });
  await app.close();
  return res.statusCode;
};

test("rbac grants by role", () => {
  assert.equal(hasPermission("viewer", "doc:write"), false);
  assert.equal(hasPermission("editor", "doc:write"), true);
  assert.equal(hasPermission("admin", "user:manage"), true);
});

test("abac refines by record", () => {
  assert.equal(can(actor("u1", "editor"), "write", doc), true);
  assert.equal(can(actor("u2", "editor"), "write", doc), false);
  assert.equal(can(actor("u1", "editor"), "write", { ...doc, status: "published" }), false);
  assert.equal(can(actor("u2", "viewer"), "read", doc), false);
  assert.equal(can(actor("u2", "viewer"), "read", { ...doc, status: "published" }), true);
});

test("no role crosses a tenant", () => {
  for (const role of ["viewer", "editor", "admin"] as const) {
    for (const action of ["read", "write", "delete"] as const) {
      assert.equal(can(actor("u9", role, "globex"), action, { ...doc, status: "published" }), false);
    }
  }
});

test("401 means who are you", async () => {
  assert.equal(await call("GET", "/docs/d1"), 401);
});

test("403 means you may not", async () => {
  assert.equal(await call("PUT", "/docs/d1", "u2", "editor"), 403);
  assert.equal(await call("DELETE", "/docs/d1", "u1", "editor"), 403);
});

test("the owner and the admin are allowed", async () => {
  assert.equal(await call("PUT", "/docs/d1", "u1", "editor"), 200);
  assert.equal(await call("PUT", "/docs/d1", "u2", "admin"), 200);
  assert.equal(await call("DELETE", "/docs/d1", "u2", "admin"), 200);
  assert.equal(docs.has("d1"), false);
});

test("another tenant gets 404, so the record's existence stays hidden", async () => {
  assert.equal(await call("GET", "/docs/pub", "u9", "admin", "globex"), 404);
  assert.equal(await call("GET", "/docs/missing", "u1", "admin"), 404);
});
