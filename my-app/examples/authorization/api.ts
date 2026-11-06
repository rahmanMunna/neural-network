import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authenticate } from "../authentication/api.js";
import { can, hasPermission } from "./policy.js";
import type { Actor, Doc, Permission, Role } from "./policy.js";

// #region guards
const actorOf = (req: FastifyRequest): Actor => ({
  id: req.user!.sub,
  role: req.user!.role as Role,
  tenant: req.user!.tenant ?? "",
});

/** A route-level gate for actions that do not depend on one record. */
export const requirePermission = (permission: Permission) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasPermission(actorOf(req).role, permission)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
// #endregion

// #region routes
export function buildDocsApi(docs: Map<string, Doc>) {
  const app = Fastify();

  /**
   * Loads the record and checks it in one step, so no handler can forget.
   * A record in another tenant answers 404: a 403 would confirm that it exists.
   */
  async function loadDoc(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, action: "read" | "write" | "delete") {
    const doc = docs.get(req.params.id);
    const actor = actorOf(req);
    if (!doc || doc.tenant !== actor.tenant) {
      reply.code(404).send({ error: "not found" });
      return null;
    }
    if (!can(actor, action, doc)) {
      reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return doc;
  }

  app.get<{ Params: { id: string } }>("/docs/:id", { preHandler: authenticate }, async (req, reply) => {
    const doc = await loadDoc(req, reply, "read");
    return doc ?? reply;
  });

  app.put<{ Params: { id: string } }>("/docs/:id", { preHandler: authenticate }, async (req, reply) => {
    const doc = await loadDoc(req, reply, "write");
    return doc ? { ok: true } : reply;
  });

  app.delete<{ Params: { id: string } }>(
    "/docs/:id",
    { preHandler: [authenticate, requirePermission("doc:delete")] },
    async (req, reply) => {
      const doc = await loadDoc(req, reply, "delete");
      if (!doc) return reply;
      docs.delete(doc.id);
      return { ok: true };
    },
  );

  return app;
}
// #endregion
