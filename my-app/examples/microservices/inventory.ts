import Fastify from "fastify";
import { z } from "zod";

// #region inventory
/** The inventory service owns stock. No other service may touch its database. */
export function buildInventory(initialStock: number) {
  const app = Fastify();
  let stock = initialStock;
  // Remembers each result by key, so a retry cannot reserve the same stock twice.
  const processed = new Map<string, { reserved: boolean }>();
  // Test hook: makes the next responses slow or broken.
  const faults = { delayMs: 0, failing: false, calls: 0 };

  app.post("/reservations", async (req, reply) => {
    faults.calls++;
    if (faults.delayMs) await new Promise((r) => setTimeout(r, faults.delayMs));
    if (faults.failing) return reply.code(503).send({ error: "unavailable" });

    const key = req.headers["idempotency-key"];
    const body = z.object({ quantity: z.number().int().positive() }).parse(req.body);
    if (typeof key !== "string") return reply.code(400).send({ error: "idempotency key required" });

    const seen = processed.get(key);
    if (seen) return seen;

    const reserved = stock >= body.quantity;
    if (reserved) stock -= body.quantity;
    const result = { reserved };
    processed.set(key, result);
    return result;
  });

  return { app, faults, stock: () => stock };
}
// #endregion
