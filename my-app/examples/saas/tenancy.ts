import Fastify from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { authenticate } from "../authentication/api.js";

// #region context
/**
 * Runs `work` as one tenant. The `true` argument scopes the setting to this
 * transaction. A plain SET would stay on the pooled connection and leak this
 * tenant into whichever request uses that connection next.
 */
export async function withTenant<T>(pool: Pool, tenantId: string, work: (db: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
// #endregion

// #region plans
/** Plans are data. Adding a tier should not need a code change at every call site. */
export const PLANS = {
  free: { maxProjects: 3, requestsPerSecond: 5 },
  pro: { maxProjects: 100, requestsPerSecond: 100 },
} as const;

export type Plan = keyof typeof PLANS;

export class QuotaExceeded extends Error {}

export async function createProject(pool: Pool, tenantId: string, name: string) {
  return withTenant(pool, tenantId, async (db) => {
    // Count-then-insert is a race: two requests could both see room for one
    // more. This lock makes one tenant's writes wait in line until COMMIT.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
    const { rows } = await db.query<{ plan: Plan }>("SELECT plan FROM tenants WHERE id = $1", [tenantId]);
    const count = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM projects");
    if (count.rows[0]!.n >= PLANS[rows[0]!.plan].maxProjects) throw new QuotaExceeded();

    const created = await db.query<{ id: string }>(
      "INSERT INTO projects (tenant_id, name) VALUES ($1, $2) RETURNING id",
      [tenantId, name],
    );
    return created.rows[0]!.id;
  });
}
// #endregion

// #region api
export function buildSaasApi(pool: Pool) {
  const app = Fastify();

  /** The tenant comes from the verified token, never from the URL or the body. */
  app.addHook("preHandler", authenticate);

  app.get("/projects", async (req) =>
    withTenant(pool, req.user!.tenant!, async (db) => {
      // No WHERE clause: the database applies the tenant filter itself.
      const { rows } = await db.query("SELECT id, name FROM projects ORDER BY name");
      return rows;
    }),
  );

  app.post("/projects", async (req, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    try {
      return { id: await createProject(pool, req.user!.tenant!, name) };
    } catch (err) {
      if (err instanceof QuotaExceeded) {
        return reply.code(402).send({ error: "plan limit reached, upgrade to add more" });
      }
      throw err;
    }
  });

  return app;
}
// #endregion
