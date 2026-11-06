import Fastify from "fastify";
import { z } from "zod";
import { InsufficientFunds, type AccountService } from "./business.js";

// #region presentation
/**
 * Presentation tier: speaks HTTP and nothing else. It validates the shape of the
 * input and maps results to status codes. It has no rules and no SQL.
 */
export function buildApi(accounts: AccountService) {
  const app = Fastify();

  app.post("/transfers", async (req, reply) => {
    const body = z
      .object({ from: z.string(), to: z.string(), cents: z.number().int().positive() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid transfer" });

    try {
      await accounts.transfer(body.data.from, body.data.to, body.data.cents);
      return { ok: true };
    } catch (err) {
      if (err instanceof InsufficientFunds) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  return app;
}
// #endregion
