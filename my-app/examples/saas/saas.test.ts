import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";
import { redis, signAccessToken } from "../authentication/tokens.js";
import { buildSaasApi, createProject, QuotaExceeded, withTenant } from "./tenancy.js";

const owner = new pg.Pool({ connectionString: "postgres://app:app@localhost:5433/app" });
// One connection, so a leaked setting would be visible on the very next query.
const pool = new pg.Pool({ connectionString: "postgres://app_user:app_user@localhost:5433/app", max: 1 });

let acme = "";
let globex = "";

before(async () => {
  await owner.query(`
    DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS tenants;
    DROP ROLE IF EXISTS app_user;
  `);
  await owner.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await owner.query("ALTER TABLE projects DISABLE ROW LEVEL SECURITY");
  await owner.query("DELETE FROM projects; DELETE FROM tenants");
  await owner.query("ALTER TABLE projects ENABLE ROW LEVEL SECURITY");
  acme = (await owner.query("INSERT INTO tenants (name, plan) VALUES ('Acme', 'free') RETURNING id")).rows[0].id;
  globex = (await owner.query("INSERT INTO tenants (name, plan) VALUES ('Globex', 'pro') RETURNING id")).rows[0].id;
});
after(async () => {
  await Promise.all([owner.end(), pool.end(), redis.quit()]);
});

test("the application role really is restricted", async () => {
  const { rows } = await pool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false });
});

test("a tenant only ever sees its own rows, with no WHERE clause", async () => {
  await createProject(pool, acme, "acme-1");
  await createProject(pool, globex, "globex-1");
  const rows = await withTenant(pool, acme, async (db) => (await db.query("SELECT name FROM projects")).rows);
  assert.deepEqual(rows, [{ name: "acme-1" }]);
});

test("no tenant set means no rows, not all rows", async () => {
  await createProject(pool, acme, "acme-1");
  assert.equal((await pool.query("SELECT * FROM projects")).rowCount, 0);
});

test("the setting does not leak to the next request on the same connection", async () => {
  await createProject(pool, acme, "acme-1");
  await withTenant(pool, acme, async (db) => db.query("SELECT 1"));
  assert.equal((await pool.query("SELECT * FROM projects")).rowCount, 0);
});

test("a tenant cannot write a row for another tenant", async () => {
  await assert.rejects(
    withTenant(pool, acme, (db) => db.query("INSERT INTO projects (tenant_id, name) VALUES ($1, 'x')", [globex])),
    /row-level security/,
  );
});

test("a tenant cannot update or delete another tenant's rows", async () => {
  await createProject(pool, globex, "globex-1");
  const changed = await withTenant(pool, acme, async (db) => {
    const u = await db.query("UPDATE projects SET name = 'hacked'");
    const d = await db.query("DELETE FROM projects");
    return (u.rowCount ?? 0) + (d.rowCount ?? 0);
  });
  assert.equal(changed, 0);
});

test("the plan quota holds even under concurrency", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => createProject(pool, acme, `p${i}`)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason instanceof QuotaExceeded));
});

test("a higher plan has a higher limit", async () => {
  for (let i = 0; i < 5; i++) await createProject(pool, globex, `p${i}`);
});

test("the HTTP API takes the tenant from the token", async () => {
  const app = buildSaasApi(pool);
  const asAcme = { authorization: `Bearer ${await signAccessToken({ sub: "u1", role: "member", tenant: acme })}` };
  const asGlobex = { authorization: `Bearer ${await signAccessToken({ sub: "u2", role: "member", tenant: globex })}` };
  await app.inject({ method: "POST", url: "/projects", headers: asAcme, payload: { name: "mine" } });
  assert.equal((await app.inject({ url: "/projects", headers: asAcme })).json().length, 1);
  assert.equal((await app.inject({ url: "/projects", headers: asGlobex })).json().length, 0);
  for (let i = 0; i < 2; i++) {
    await app.inject({ method: "POST", url: "/projects", headers: asAcme, payload: { name: `n${i}` } });
  }
  const over = await app.inject({ method: "POST", url: "/projects", headers: asAcme, payload: { name: "fourth" } });
  assert.equal(over.statusCode, 402);
  await app.close();
});
