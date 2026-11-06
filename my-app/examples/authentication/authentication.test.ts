import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { SignJWT } from "jose";
import { buildAuthApi } from "./api.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { redis, signAccessToken, verifyAccessToken } from "./tokens.js";

const user = { email: "ada@example.com", password: "correct horse battery" };

function cookieOf(res: { cookies: Array<{ name: string; value: string }> }) {
  return res.cookies.find((c) => c.name === "refresh")!.value;
}

async function signedIn() {
  const app = buildAuthApi();
  await app.inject({ method: "POST", url: "/auth/register", payload: user });
  const login = await app.inject({ method: "POST", url: "/auth/login", payload: user });
  return { app, login, refresh: cookieOf(login), access: login.json().accessToken as string };
}

const refreshWith = (app: ReturnType<typeof buildAuthApi>, token: string) =>
  app.inject({ method: "POST", url: "/auth/refresh", cookies: { refresh: token } });

beforeEach(() => redis.flushdb());
after(() => redis.quit());

test("passwords are hashed with argon2id and verified", async () => {
  const stored = await hashPassword("s3cret-password");
  assert.ok(stored.startsWith("$argon2id$"));
  assert.equal(await verifyPassword(stored, "s3cret-password"), true);
  assert.equal(await verifyPassword(stored, "wrong"), false);
  assert.equal(await verifyPassword(undefined, "anything"), false);
});

test("register, login and call a protected route", async () => {
  const { app, access, login } = await signedIn();
  assert.equal(login.statusCode, 200);
  const me = await app.inject({ url: "/me", headers: { authorization: `Bearer ${access}` } });
  assert.deepEqual(me.json(), { id: "1", role: "member" });
  await app.close();
});

test("the refresh cookie is locked down", async () => {
  const { app, login } = await signedIn();
  const c = login.cookies.find((x) => x.name === "refresh")!;
  assert.equal(c.httpOnly, true);
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, "Strict");
  await app.close();
});

test("wrong password and unknown email look identical", async () => {
  const { app } = await signedIn();
  const wrong = await app.inject({ method: "POST", url: "/auth/login", payload: { ...user, password: "wrong password here" } });
  const unknown = await app.inject({ method: "POST", url: "/auth/login", payload: { ...user, email: "no@example.com" } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body, unknown.body);
  await app.close();
});

test("no token and a bad token both get 401", async () => {
  const { app, access } = await signedIn();
  assert.equal((await app.inject({ url: "/me" })).statusCode, 401);
  const tampered = access.slice(0, -2) + (access.endsWith("aa") ? "bb" : "aa");
  assert.equal((await app.inject({ url: "/me", headers: { authorization: `Bearer ${tampered}` } })).statusCode, 401);
  await app.close();
});

test("an expired token is rejected", async () => {
  const token = await signAccessToken({ sub: "1", role: "member" }, "1s");
  await sleep(2_100);
  await assert.rejects(verifyAccessToken(token));
});

test("a token signed with another key is rejected", async () => {
  const forged = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("1")
    .setIssuer("api.example.com")
    .setAudience("app.example.com")
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode("attacker-key-attacker-key-attacker-key"));
  await assert.rejects(verifyAccessToken(forged));
});

test("an unsigned alg:none token is rejected", async () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const forged = `${b64({ alg: "none" })}.${b64({ sub: "1", role: "admin" })}.`;
  await assert.rejects(verifyAccessToken(forged));
});

test("refresh rotates: the new token works, the old one does not", async () => {
  const { app, refresh } = await signedIn();
  const first = await refreshWith(app, refresh);
  assert.equal(first.statusCode, 200);
  assert.ok(first.json().accessToken);
  const next = cookieOf(first);
  assert.notEqual(next, refresh);
  assert.equal((await refreshWith(app, next)).statusCode, 200);
  await app.close();
});

test("reusing an old token revokes the whole family", async () => {
  const { app, refresh } = await signedIn();
  // The attacker and the victim both hold `refresh`. The attacker goes first.
  const stolen = await refreshWith(app, refresh);
  const attackerToken = cookieOf(stolen);
  // The victim then presents the same token: reuse.
  assert.equal((await refreshWith(app, refresh)).statusCode, 401);
  // The attacker's newer token is now dead too.
  assert.equal((await refreshWith(app, attackerToken)).statusCode, 401);
  await app.close();
});

test("two concurrent refreshes with one token cannot both win", async () => {
  const { app, refresh } = await signedIn();
  const results = await Promise.all([refreshWith(app, refresh), refreshWith(app, refresh)]);
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  await app.close();
});

test("logout ends the session", async () => {
  const { app, refresh } = await signedIn();
  await app.inject({ method: "POST", url: "/auth/logout", cookies: { refresh } });
  assert.equal((await refreshWith(app, refresh)).statusCode, 401);
  await app.close();
});

test("redis holds only hashes of refresh tokens", async () => {
  const { app, refresh } = await signedIn();
  const keys = await redis.keys("refresh:*");
  assert.equal(keys.length, 1);
  assert.ok(!keys[0]!.includes(refresh));
  await app.close();
});
