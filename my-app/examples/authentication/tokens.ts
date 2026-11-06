import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { jwtVerify, SignJWT } from "jose";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

// #region access
// Load this from a secret manager. At least 32 random bytes.
const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-only-secret-change-me-32-bytes-min");
const issuer = "api.example.com";
const audience = "app.example.com";

export interface AccessClaims {
  sub: string;
  role: string;
  tenant?: string;
}

/** The access token is short-lived and checked with no database lookup. */
export function signAccessToken(claims: AccessClaims, expiresIn = "15m") {
  return new SignJWT({ role: claims.role, tenant: claims.tenant })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

/** Pinning the algorithm blocks attacks that swap it in the token's header. */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], issuer, audience });
  return {
    sub: payload.sub!,
    role: String(payload.role),
    tenant: payload.tenant as string | undefined,
  };
}
// #endregion

// #region refresh
const REFRESH_TTL = 60 * 60 * 24 * 30;

/** Store only a hash, so a leaked Redis dump contains no usable tokens. */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

interface Session {
  userId: string;
  role: string;
  /** Every token descended from one login shares this family id. */
  family: string;
}

async function store(session: Session) {
  const token = randomBytes(32).toString("base64url");
  await redis.set(`refresh:${hash(token)}`, JSON.stringify(session), "EX", REFRESH_TTL);
  return token;
}

export const startSession = (userId: string, role: string) =>
  store({ userId, role, family: randomUUID() });

export class TokenReuse extends Error {}

/**
 * Rotation: each refresh token works once. GETDEL is atomic, so two requests
 * racing with one token cannot both win. Presenting a used token means it was
 * stolen, or the thief used it first, so the whole family is revoked.
 */
export async function rotate(token: string) {
  const key = hash(token);
  const raw = await redis.getdel(`refresh:${key}`);

  if (!raw) {
    const family = await redis.get(`used:${key}`);
    if (family) {
      await redis.set(`revoked:${family}`, "1", "EX", REFRESH_TTL);
      throw new TokenReuse("refresh token reuse detected");
    }
    return null;
  }

  const session = JSON.parse(raw) as Session;
  await redis.set(`used:${key}`, session.family, "EX", REFRESH_TTL);
  if (await redis.exists(`revoked:${session.family}`)) return null;

  return {
    session,
    refreshToken: await store(session),
    accessToken: await signAccessToken({ sub: session.userId, role: session.role }),
  };
}

/** Logout ends this family only, so other devices stay signed in. */
export async function endSession(token: string) {
  const raw = await redis.getdel(`refresh:${hash(token)}`);
  if (raw) {
    const { family } = JSON.parse(raw) as Session;
    await redis.set(`revoked:${family}`, "1", "EX", REFRESH_TTL);
  }
}
// #endregion
