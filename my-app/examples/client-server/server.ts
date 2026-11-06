import Fastify from "fastify";
import { z } from "zod";

// #region server
export function buildServer(instance: string) {
  // Behind a reverse proxy the TCP peer is always the proxy, so the real client
  // comes from X-Forwarded-For. This is only safe because our nginx overwrites
  // that header, and because the app is not reachable except through nginx.
  const app = Fastify({ trustProxy: true });

  // Load balancers call this to decide whether to send traffic here.
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get<{ Params: { id: string } }>("/api/products/:id", async (req, reply) => {
    // Never trust input: parse it before it reaches any other layer.
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return reply.code(400).send({ error: "invalid id" });

    // Real handlers call the cache and database here.
    return {
      id: id.data,
      name: "Keyboard",
      servedBy: instance,
      clientIp: req.ip,
      protocol: req.protocol,
    };
  });

  return app;
}
// #endregion
