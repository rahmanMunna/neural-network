import type { FastifyInstance, FastifyRequest } from "fastify";
import { tokenBucket } from "./limiters.js";

// #region plugin
export interface RateLimitOptions {
  capacity: number;
  perSecond: number;
  /** Who is being limited. Prefer a user or API key over an IP address. */
  keyOf?: (req: FastifyRequest) => string;
  /** Runs when Redis is unreachable. True keeps the API up without limits. */
  failOpen?: boolean;
}

export function rateLimit(app: FastifyInstance, opts: RateLimitOptions) {
  const keyOf = opts.keyOf ?? ((req) => req.ip);

  app.addHook("onRequest", async (req, reply) => {
    let decision;
    try {
      decision = await tokenBucket(`rl:${keyOf(req)}`, opts.capacity, opts.perSecond);
    } catch (err) {
      if (opts.failOpen ?? true) {
        req.log.error(err, "rate limiter unavailable");
        return;
      }
      return reply.code(503).send({ error: "try again later" });
    }

    reply.header("RateLimit-Limit", opts.capacity);
    reply.header("RateLimit-Remaining", decision.remaining);

    if (!decision.allowed) {
      // Tell the client exactly when to return, so it does not retry blindly.
      reply.header("Retry-After", Math.ceil(decision.retryAfterMs / 1000));
      return reply.code(429).send({ error: "too many requests" });
    }
  });
}
// #endregion
