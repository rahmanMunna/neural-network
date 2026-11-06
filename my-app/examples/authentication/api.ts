import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./passwords.js";
import { endSession, rotate, signAccessToken, startSession, TokenReuse, verifyAccessToken } from "./tokens.js";
import type { AccessClaims } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AccessClaims;
  }
}

// #region guard
/** Attach this to every protected route. It answers: who is calling? */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "not authenticated" });
  try {
    req.user = await verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: "invalid or expired token" });
  }
}
// #endregion

// #region routes
const credentials = z.object({ email: z.email(), password: z.string().min(12).max(200) });

interface Account {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
}

// The refresh token stays out of reach of JavaScript, so XSS cannot steal it.
const refreshCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/auth",
  maxAge: 60 * 60 * 24 * 30,
} as const;

export function buildAuthApi() {
  const app = Fastify();
  app.register(cookie);
  const accounts = new Map<string, Account>(); // Your users table in production.

  app.post("/auth/register", async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    if (accounts.has(email)) return reply.code(409).send({ error: "email already registered" });
    const id = String(accounts.size + 1);
    accounts.set(email, { id, email, passwordHash: await hashPassword(password), role: "member" });
    return reply.code(201).send({ id });
  });

  app.post("/auth/login", async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    const account = accounts.get(email);
    // The same message for both failures, so attackers cannot probe for emails.
    if (!(await verifyPassword(account?.passwordHash, password))) {
      return reply.code(401).send({ error: "invalid email or password" });
    }
    const refresh = await startSession(account!.id, account!.role);
    reply.setCookie("refresh", refresh, refreshCookie);
    return { accessToken: await signAccessToken({ sub: account!.id, role: account!.role }) };
  });

  app.post("/auth/refresh", async (req, reply) => {
    const token = req.cookies.refresh;
    if (!token) return reply.code(401).send({ error: "no session" });
    try {
      const next = await rotate(token);
      if (!next) return reply.code(401).send({ error: "session expired" });
      reply.setCookie("refresh", next.refreshToken, refreshCookie);
      return { accessToken: next.accessToken };
    } catch (err) {
      if (err instanceof TokenReuse) return reply.code(401).send({ error: "session revoked" });
      throw err;
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.cookies.refresh) await endSession(req.cookies.refresh);
    reply.clearCookie("refresh", { path: "/auth" });
    return { ok: true };
  });

  app.get("/me", { preHandler: authenticate }, async (req) => ({ id: req.user!.sub, role: req.user!.role }));

  return app;
}
// #endregion
