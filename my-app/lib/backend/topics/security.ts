import type { Topic } from "../topic.ts";

export const rateLimiting: Topic = {
  slug: "rate-limiting",
  title: "Rate Limiting",
  nav: "Rate Limiting",
  group: "Traffic and security",
  lede: "Refuse excess requests early, so that your servers stay healthy for everyone else. Three algorithms, each with a real trade-off, and all of them atomic in Redis.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "A rate limiter counts requests per client and refuses those over a limit with `429 Too Many Requests`. It is cheap to refuse a request, and expensive to process one you cannot handle." },
      ],
    },
    {
      heading: "What problem it solves",
      blocks: [
        {
          list: [
            "Abuse: password guessing, scraping and scripted attacks.",
            "Accidents: a customer's retry loop can look exactly like an attack.",
            "Fairness: one busy client should not slow everyone down.",
            "Cost: every request you do not process saves money.",
          ],
        },
      ],
    },
    {
      heading: "The three algorithms",
      blocks: [
        {
          table: {
            head: ["Algorithm", "How it works", "Strength", "Weakness"],
            rows: [
              ["Fixed window", "A counter per clock window", "Very cheap", "Double burst across a boundary"],
              ["Sliding log", "A timestamp per request", "Exact", "Memory grows with the limit"],
              ["Token bucket", "Tokens refill steadily, each request spends one", "Allows short bursts, cheap", "Slightly more logic"],
            ],
          },
        },
        { p: "Token bucket is the usual default, because real users are bursty. A page load fires 10 requests at once, then nothing for a while." },
      ],
    },
    {
      heading: "Why it needs Redis",
      blocks: [
        { p: "A counter in one process's memory only sees that process's traffic. With 4 instances, a limit of 100 really allows 400. The count must live somewhere shared." },
        { p: "It must also be atomic. Reading a count, deciding, then writing it back lets concurrent requests all read the same value. A Lua script runs as one step, which is why this guide's test can fire 200 concurrent requests at a limit of 50 and get exactly 50." },
      ],
    },
    {
      heading: "Who should you limit?",
      blocks: [
        { p: "Prefer the most specific identity available: an API key or user id. IP addresses are shared by offices and mobile networks, so an IP limit can block a whole company. Use IP only for anonymous traffic, such as login attempts." },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Client", x: 0, y: 0.4 },
      { id: "limiter", kind: "limiter", label: "Rate limiter", sub: "onRequest hook", x: 0.4, y: 0.4 },
      { id: "redis", kind: "redis", label: "Redis", sub: "shared counters", x: 0.4, y: 1 },
      { id: "api", kind: "api", label: "Route handler", x: 0.92, y: 0.4 },
    ],
    scenarios: [
      {
        id: "bucket",
        label: "Token bucket",
        summary: "A bucket holds up to 3 tokens and refills at 1 per second. Each request spends one.",
        steps: [
          { phase: "Allow", title: "A request spends a token", body: "The limiter runs before your handler. The Lua script refills the bucket based on elapsed time, then takes one token, all in a single atomic step.", hops: [["client", "limiter", "GET /api", "request"], ["limiter", "redis", "EVAL token_bucket", "request"], ["redis", "limiter", "allowed, 2 left", "response"]], set: { redis: ["tokens: 2 of 3"] }, code: "rate-limiting/limiters.ts#token-bucket" },
          { phase: "Allow", title: "The request reaches your code", body: "The response carries `RateLimit-Remaining`, so well-behaved clients can slow down before they hit the limit.", hops: [["limiter", "api", "GET /api", "request"], ["api", "client", "200, remaining 2", "response"]] },
          { phase: "Burst", title: "A burst drains the bucket", body: "Two more requests arrive at once and both pass. This is the bucket's purpose: real traffic is bursty, so a short burst should be fine.", hops: [["client", "limiter", "2 more requests", "request"], ["limiter", "redis", "EVAL × 2", "request"]], set: { redis: ["tokens: 0 of 3"] } },
          { phase: "Reject", title: "An empty bucket means 429", body: "The limiter answers immediately, and your handler never runs. `Retry-After` tells the client exactly when to return, so it does not hammer you with blind retries.", hops: [["client", "limiter", "GET /api", "request"], ["limiter", "redis", "EVAL", "request"], ["redis", "limiter", "denied, wait 1s", "error"], ["limiter", "client", "429 Retry-After: 1", "error"]], code: "rate-limiting/plugin.ts#plugin" },
          { phase: "Refill", title: "Tokens return with time", body: "Redis does not run a timer. When the next request arrives, the script works out how many tokens have accrued from the elapsed time, so idle clients cost nothing.", hops: [["client", "limiter", "GET /api, 2s later", "request"], ["limiter", "redis", "EVAL", "request"]], card: { at: "redis", title: "Lua script", tag: "computed on read", rows: ["elapsed: 2000 ms", "refill: 2 × 1 per second", "tokens: min(3, 0 + 2) = 2", { t: "allowed, 1 left", tone: "response" }] }, set: { redis: ["tokens: 1 of 3"] } },
        ],
      },
    ],
  },
  build: {
    intro: "You will implement all three algorithms as atomic Redis scripts, then add them to an API with proper headers. The tests prove exact limits under 200 concurrent requests, and they show the fixed window's double burst really happening.",
    needs: ["Node.js 20 or newer", "Redis"],
    install: "npm install ioredis fastify",
    steps: [
      { title: "Fixed window", explain: ["`INCR` then set the expiry on the first request. Doing both in one script means a crash cannot leave a counter that never expires.", "The weakness: 5 requests at the end of a window plus 5 at the start of the next gives 10 in moments. The test reproduces this."], code: "rate-limiting/limiters.ts#fixed-window" },
      { title: "Sliding log", explain: ["Each request adds a timestamp to a sorted set, and old entries are removed. The limit holds over any span.", "`redis.call(\"TIME\")` uses the server's clock, so instances with skewed clocks still agree.", "Each member needs a unique value, or two requests in the same millisecond would collapse into one."], code: "rate-limiting/limiters.ts#sliding-log" },
      { title: "Token bucket", explain: ["Only two numbers are stored per client: tokens and the last update time. So it is cheap, however large the limit.", "Refill is calculated on read, with `math.min` capping it at capacity.", "The key expires once the bucket would be full again. A missing key means a full bucket, so nothing is lost."], code: "rate-limiting/limiters.ts#token-bucket" },
      { title: "Add it to your API", explain: ["`onRequest` runs before body parsing, so rejected requests cost almost nothing.", "`keyOf` decides who is limited. Pass the user or API key once you have it.", "`failOpen` is a real decision. If Redis is down, do you stop limiting or stop serving? Most APIs choose to keep serving. For login endpoints, consider failing closed."], code: "rate-limiting/plugin.ts#plugin", where: "Register this early in your app, before your routes. Use stricter settings on login routes." },
    ],
    integrate: [
      "Add it in report-only mode first: log what would be rejected, and tune from real traffic.",
      "Set a generous global limit, then strict ones on login and expensive endpoints.",
      "Key by user or API key where possible.",
      "Make sure your proxy overwrites `X-Forwarded-For`, or IP limits can be bypassed. See Client-Server.",
      "Document your limits, and return `Retry-After`.",
    ],
    mistakes: [
      { title: "Counting in process memory", text: "Each instance has its own count, so the real limit is multiplied by your instance count." },
      { title: "Read, then write", text: "`GET`, compare, `INCR` is a race: concurrent requests all pass. Use `INCR`'s result, or a Lua script." },
      { title: "Limiting by a forgeable IP", text: "If your proxy appends to `X-Forwarded-For`, clients can pretend to be anyone and get a new limit each time." },
      { title: "No Retry-After", text: "Clients retry immediately and make the overload worse." },
      { title: "One limit for everything", text: "A login and a static config read have very different costs. Limit by cost." },
    ],
  },
  simulate: {
    intro: "First step through the algorithms one request at a time. Then see what a limiter does for a whole system.",
    preset: "rate-limit",
    lab: "rate-limit",
    labIntro: "Set a limit, then try to beat each algorithm. On Fixed window, wait until just before a dashed line, burst, then burst again just after it.",
    tries: [
      "Press Run. Traffic is 300 per second and the limit is 100: the API stays healthy, while the excess gets 429.",
      "Click the limiter, press Remove, and connect Client straight to API. Now everything is accepted, and the system degrades for all.",
      "Switch the algorithm and compare latency and rejections.",
    ],
  },
  sources: [
    { label: "MDN: 429 Too Many Requests", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429" },
    { label: "Redis: scripting with Lua", url: "https://redis.io/docs/latest/develop/programmability/eval-intro/" },
  ],
};

export const authentication: Topic = {
  slug: "authentication",
  title: "Authentication",
  nav: "Authentication",
  group: "Traffic and security",
  lede: "Proving who someone is. Safe password storage, short-lived access tokens, and rotating refresh tokens that detect theft.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Authentication answers: who are you? Authorization answers a different question: what may you do? They are separate steps, and mixing them up causes real bugs. This page covers the first." },
      ],
    },
    {
      heading: "Storing passwords",
      blocks: [
        { p: "Never store a password, even encrypted, since encryption can be reversed. Store a slow one-way hash. Fast hashes like SHA-256 are built for speed, so an attacker with a leaked database can try billions of guesses a second. Argon2id is deliberately slow and uses a lot of memory, which makes each guess expensive." },
      ],
    },
    {
      heading: "Sessions or tokens?",
      blocks: [
        {
          table: {
            head: ["", "Server session", "JWT access token"],
            rows: [
              ["Where state lives", "Server, in Redis", "In the token"],
              ["Check needs a lookup?", "Yes", "No, just the signature"],
              ["Revoke instantly?", "Yes, delete it", "No, wait for expiry"],
              ["Good for", "Typical web apps", "APIs, many services"],
            ],
          },
        },
        { p: "This guide combines both. A JWT lasts 15 minutes and needs no lookup. A long-lived refresh token lives in Redis and can be revoked. You get fast checks, and you can still end a session within 15 minutes." },
      ],
    },
    {
      heading: "A JWT is signed, not encrypted",
      blocks: [
        { p: "Anyone can read a JWT's contents by decoding it, so never put secrets inside. The signature only proves that your server created it and that nobody has changed it. Always pin the expected algorithm when verifying, which blocks attacks that change the token's header." },
      ],
    },
    {
      heading: "Refresh token rotation",
      blocks: [
        { p: "Each refresh token works exactly once, and using it returns a new one. If a stolen token is used, then either the thief or the real user ends up presenting an already-used token. That cannot happen in normal use, so it proves theft, and the server revokes that whole login." },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Browser", x: 0, y: 0.25 },
      { id: "attacker", kind: "attacker", label: "Attacker", sub: "stolen token", x: 0, y: 1 },
      { id: "api", kind: "api", label: "Auth API", x: 0.44, y: 0.25 },
      { id: "db", kind: "db", label: "Users table", sub: "argon2id hashes", x: 0.95, y: 0 },
      { id: "redis", kind: "redis", label: "Redis", sub: "refresh tokens", x: 0.95, y: 0.8 },
    ],
    scenarios: [
      {
        id: "login",
        label: "Login and using a token",
        summary: "What happens from typing a password to calling a protected route.",
        steps: [
          { phase: "Login", title: "The password is checked, not compared", body: "The stored hash contains its own salt and settings. Argon2 hashes the attempt the same way and compares the results. The stored password can never be recovered.", hops: [["client", "api", "POST /auth/login", "request"], ["api", "db", "find user by email", "request"], ["db", "api", "$argon2id$v=19…", "response"]], card: { at: "api", title: "argon2.verify", tag: "slow on purpose", rows: ["hash the attempt", "same salt, same cost", { t: "hashes match", tone: "response" }] }, code: "authentication/passwords.ts#passwords" },
          { phase: "Login", title: "Two tokens are issued", body: "A short access token, returned as JSON. A long refresh token, set as an `HttpOnly` cookie so JavaScript cannot read it. Only its SHA-256 hash is stored, so a Redis leak exposes no usable tokens.", hops: [["api", "redis", "SET refresh:hash", "data"], ["api", "client", "JWT + HttpOnly cookie", "response"]], set: { redis: ["refresh:9f2e  family A"], client: ["access token: 15 min"] }, code: "authentication/tokens.ts#access" },
          { phase: "Use", title: "Protected routes check the signature", body: "No database lookup is needed. The server recomputes the signature with its secret and checks the expiry, issuer and audience.", hops: [["client", "api", "GET /me + Bearer JWT", "request"], ["api", "client", "200 { id: 1 }", "response"]], card: { at: "api", title: "jwtVerify", tag: "no lookup", rows: ["signature valid", "algorithm is HS256", "not expired", "issuer and audience match"] }, code: "authentication/api.ts#guard" },
          { phase: "Refresh", title: "A new token, without logging in again", body: "After 15 minutes the access token expires. The browser sends its cookie to `/auth/refresh`. `GETDEL` removes the old token atomically, and a new pair is issued.", hops: [["client", "api", "POST /auth/refresh", "request"], ["api", "redis", "GETDEL refresh:9f2e", "request"], ["api", "redis", "SET refresh:c41b", "data"], ["api", "client", "new JWT + new cookie", "response"]], set: { redis: ["refresh:c41b  family A", "used:9f2e"] }, code: "authentication/tokens.ts#refresh" },
        ],
      },
      {
        id: "theft",
        label: "Detecting a stolen token",
        summary: "A thief copies a refresh token. Rotation turns that theft into something the server can detect.",
        steps: [
          { phase: "Theft", title: "The attacker uses the stolen token first", body: "It is valid, so this works. The attacker gets a new pair. The server cannot tell them apart yet.", hops: [["attacker", "api", "refresh with 9f2e", "error"], ["api", "redis", "GETDEL refresh:9f2e", "request"], ["api", "attacker", "new tokens", "response"]], set: { redis: ["refresh:c41b  family A", "used:9f2e"], attacker: ["holds c41b"] } },
          { phase: "Detection", title: "The real user presents the same token", body: "Their browser still holds `9f2e`. It no longer exists, but `used:9f2e` records that it was already spent. A used token appearing again proves that two parties hold it.", hops: [["client", "api", "refresh with 9f2e", "request"], ["api", "redis", "GET used:9f2e", "request"]], card: { at: "redis", title: "Reuse detected", tag: "family A", tone: "error", rows: [{ t: "9f2e was already used", tone: "error" }, "someone else holds this login", { t: "revoke all of family A", tone: "error", strong: true }] }, code: "authentication/tokens.ts#refresh" },
          { phase: "Revoke", title: "The whole login is ended", body: "The family is marked as revoked, so the attacker's newer token is dead too. The user is asked to log in again. It is a small price, and only the affected login is hit.", hops: [["api", "redis", "SET revoked:A", "error"], ["api", "client", "401 session revoked", "error"], ["attacker", "api", "refresh with c41b", "error"], ["api", "attacker", "401", "error"]], set: { redis: ["revoked: family A"], attacker: null } },
        ],
      },
    ],
  },
  build: {
    intro: "You will build register, login, refresh and logout, with hashed passwords and rotating tokens. Tests cover forged tokens, `alg: none`, expiry, concurrent refreshes and reuse detection.",
    needs: ["Node.js 20 or newer", "Redis"],
    install: "npm install argon2 jose ioredis fastify @fastify/cookie zod",
    tree: "src/auth/\n├─ passwords.ts    hashing\n├─ tokens.ts       JWT and refresh tokens\n└─ api.ts          routes and the guard",
    steps: [
      { title: "Hash passwords", explain: ["`argon2.hash` creates a random salt and stores it inside the result, along with the cost settings. There is no separate salt column to manage.", "The decoy hash closes a timing leak. Without it, a login for an unknown email returns faster, because no hashing happens, and that reveals which emails exist."], code: "authentication/passwords.ts#passwords" },
      { title: "Issue and verify access tokens", explain: ["The token is short-lived and carries only what routes need.", "`algorithms: [\"HS256\"]` is essential. The tests confirm that an unsigned `alg: none` token and one signed with a different key are both refused.", "HS256 uses one shared secret, so anything that can verify can also sign. If several services verify tokens, use an asymmetric algorithm like ES256, so only the auth service holds the private key."], code: "authentication/tokens.ts#access" },
      { title: "Rotate refresh tokens", explain: ["Tokens are random bytes, not JWTs, because they are looked up rather than verified.", "Only a hash is stored. Reading Redis gives an attacker nothing they can use.", "`GETDEL` is atomic, so two concurrent refreshes with one token cannot both succeed. The test proves it.", "`used:` entries are what detect reuse. The `family` links every token from one login, so all of them can be revoked together."], code: "authentication/tokens.ts#refresh" },
      { title: "Guard your routes", explain: ["Attach this as a `preHandler`. Both a missing token and an invalid one return `401`, because either way the caller's identity is unknown."], code: "authentication/api.ts#guard" },
      { title: "Build the routes", explain: ["The login error is identical for a wrong password and an unknown email, so attackers cannot use it to find accounts.", "`httpOnly` stops JavaScript reading the cookie, `secure` limits it to HTTPS, and `sameSite: strict` stops other sites sending it. `path: /auth` means it is only sent where needed.", "`secure` cookies need HTTPS, though browsers treat `localhost` as secure, so local development works."], code: "authentication/api.ts#routes", where: "Replace the `accounts` map with your users table. Add a strict rate limit to `/auth/login`." },
    ],
    integrate: [
      "If you have passwords in another hash, rehash each one to argon2id at the user's next successful login.",
      "Add `authenticate` route by route, watching your logs for unexpected `401`s.",
      "Store the JWT secret in a secret manager, and plan how to rotate it.",
      "Rate limit login by account and by IP. See Rate Limiting.",
      "Consider a provider such as Auth0 or Clerk, or an open-source server like Keycloak. Passkeys and SSO are a lot of work to build yourself.",
    ],
    mistakes: [
      { title: "Fast hashes for passwords", text: "SHA-256 and MD5 are designed for speed, which is exactly what an attacker wants." },
      { title: "Storing tokens in localStorage", text: "Any script on your page can read it, so one XSS bug hands over the session. Use `HttpOnly` cookies for long-lived tokens." },
      { title: "Long-lived JWTs", text: "A JWT cannot be revoked. Keep access tokens short, and use a refresh token for the long session." },
      { title: "Not pinning the algorithm", text: "Letting the token's header choose the algorithm has caused real authentication bypasses." },
      { title: "Different errors for wrong password and unknown email", text: "This tells attackers which accounts exist." },
      { title: "Secrets in the JWT", text: "The payload is only encoded. Anyone holding the token can read it." },
    ],
  },
  simulate: {
    intro: "Every request passes an auth check before reaching your code. Rejected requests never touch the database.",
    preset: "auth",
    tries: [
      "Press Run. About 10% of requests carry invalid tokens, and get 401 without costing any database work.",
      "Raise Check time to 40 ms, to imagine calling a remote auth server on every request. Then consider why JWTs avoid that lookup.",
      "Take the auth component down. With no way to verify identity, nothing gets through.",
    ],
  },
  sources: [
    { label: "OWASP Password Storage Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html" },
    { label: "OAuth 2.0 Security Best Current Practice: refresh token rotation", url: "https://datatracker.ietf.org/doc/html/rfc9700" },
    { label: "jose", url: "https://github.com/panva/jose" },
  ],
};

export const authorization: Topic = {
  slug: "authorization",
  title: "Authorization",
  nav: "Authorization",
  group: "Traffic and security",
  lede: "Deciding what an identified user may do. Roles for the broad strokes, attributes for the record in front of you, and a clear difference between 401, 403 and 404.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Authentication established who the user is. Authorization decides whether this user may perform this action on this record. Broken access control sits at the top of the OWASP Top 10, because it is easy to check at the door and forget to check the record." },
      ],
    },
    {
      heading: "Two models that work together",
      blocks: [
        {
          table: {
            head: ["", "RBAC, role-based", "ABAC, attribute-based"],
            rows: [
              ["Asks", "What is your role?", "What do we know about you and this record?"],
              ["Example", "Editors may write", "Editors may write their own drafts"],
              ["Lives", "A table of roles", "A function of user and record"],
              ["Strength", "Simple, easy to audit", "Expresses real rules"],
            ],
          },
        },
        { p: "Most systems need both. RBAC gives the coarse permission, and ABAC refines it for the specific record." },
      ],
    },
    {
      heading: "401, 403 or 404",
      blocks: [
        {
          table: {
            head: ["Status", "Means", "Use when"],
            rows: [
              ["401 Unauthorized", "I do not know who you are", "No token, or an invalid one"],
              ["403 Forbidden", "I know who you are, and the answer is no", "Your role or the record forbids it"],
              ["404 Not Found", "Nothing for you here", "The record is in another tenant"],
            ],
          },
        },
        { p: "Why 404 for another tenant's record? A 403 confirms that it exists, which lets an attacker probe for ids. A 404 reveals nothing." },
      ],
    },
    {
      heading: "The most common bug",
      blocks: [
        { p: "A route checks that you are logged in, then loads `/invoices/42` with no check that invoice 42 is yours. Change the number in the URL and you can read other customers' data. Known as IDOR, it comes from checking the role and never checking the record." },
        { callout: "Check permission on the record itself, on the server, in a place no handler can skip. Hiding a button in the UI is not access control.", title: "The rule" },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Editor", sub: "role: editor", x: 0, y: 0.45 },
      { id: "authn", kind: "auth", label: "Authenticate", sub: "who are you?", x: 0.3, y: 0.45 },
      { id: "role", kind: "limiter", label: "Role check", sub: "RBAC", x: 0.6, y: 0.05 },
      { id: "policy", kind: "service", label: "Record check", sub: "ABAC", x: 0.6, y: 0.85 },
      { id: "db", kind: "db", label: "Documents", x: 0.98, y: 0.85 },
      { id: "api", kind: "api", label: "Handler", sub: "does the work", x: 0.98, y: 0.25 },
    ],
    scenarios: [
      {
        id: "allow",
        label: "A request that passes",
        summary: "An editor updates their own draft. Watch every gate it must pass.",
        steps: [
          { phase: "Who", title: "First, identity", body: "With no valid token the request stops here with `401`. Authorization is impossible without knowing who is asking.", hops: [["client", "authn", "PUT /docs/1 + JWT", "request"]], set: { authn: ["sub: u1, editor"] } },
          { phase: "Role", title: "Does the role allow this at all?", body: "Editors have `doc:write`. This check needs no database, so it can reject cheaply.", hops: [["authn", "role", "editor, doc:write", "request"]], code: "authorization/policy.ts#rbac" },
          { phase: "Record", title: "Load the record, then check it", body: "Roles cannot express ownership. The record must be loaded and the actual rule applied: same tenant, own document, still a draft.", hops: [["role", "policy", "can(actor, write, doc)", "request"], ["policy", "db", "load doc 1", "request"], ["db", "policy", "owner u1, draft", "response"]], card: { at: "policy", title: "Policy", tag: "this user, this record", rows: [{ t: "tenant matches", tone: "response" }, { t: "owner matches", tone: "response" }, { t: "status is draft", tone: "response" }] }, code: "authorization/policy.ts#abac" },
          { phase: "Work", title: "Only now does the handler run", body: "Because the check sits in the path to the data, no handler can forget it.", hops: [["policy", "api", "doc 1", "request"], ["api", "client", "200 OK", "response"]], code: "authorization/api.ts#routes" },
        ],
      },
      {
        id: "deny",
        label: "Three ways to be refused",
        summary: "Each refusal happens at a different gate, and gives a different status for a good reason.",
        steps: [
          { phase: "401", title: "Unknown caller", body: "The token is missing or invalid, so identity is unknown.", hops: [["client", "authn", "PUT /docs/1", "request"], ["authn", "client", "401", "error"]] },
          { phase: "403", title: "Known caller, not allowed", body: "This editor owns the document, but it is published, so the rule says no. The caller is told so, because they are entitled to see it.", hops: [["client", "authn", "PUT /docs/1 + JWT", "request"], ["authn", "role", "doc:write ok", "request"], ["role", "policy", "can(write)?", "request"], ["policy", "client", "403", "error"]] },
          { phase: "404", title: "Another tenant's record", body: "Even an admin from another tenant gets 404. A 403 would confirm that this id exists.", hops: [["client", "authn", "GET /docs/1 + JWT", "request"], ["authn", "role", "admin", "request"], ["role", "policy", "tenant differs", "request"], ["policy", "client", "404", "error"]] },
        ],
      },
    ],
  },
  build: {
    intro: "You will build role permissions, record-level policies, and route guards that cannot be skipped. The tests check every role against every action across tenants.",
    needs: ["Node.js 20 or newer", "The Authentication guide, for `authenticate`"],
    install: "npm install fastify jose ioredis",
    tree: "src/authz/\n├─ policy.ts       pure rules\n└─ guards.ts       route integration",
    steps: [
      { title: "Define roles as data", explain: ["Permissions are named actions, and roles are lists of them. Adding a role touches one line.", "Code checks permissions, never role names. `if (role === 'admin')` scattered around a codebase is painful to change."], code: "authorization/policy.ts#rbac" },
      { title: "Write record-level rules", explain: ["`can` is a pure function, with no HTTP and no database. That means every combination can be tested directly.", "The tenant check comes first and overrides everything. No role crosses a tenant.", "Each branch denies by default, ending in a specific permission."], code: "authorization/policy.ts#abac", where: "Keep every rule in this one file. Then you can read your entire access policy in one place." },
      { title: "Create a route gate", explain: ["This covers permissions that do not depend on a specific record. It runs after `authenticate` and needs no database."], code: "authorization/api.ts#guards" },
      { title: "Check the record in one place", explain: ["`loadDoc` both fetches and authorizes, so a handler cannot get a record without the check.", "A record in another tenant returns `404`, and the rules return `403`. The tests pin down both."], code: "authorization/api.ts#routes" },
    ],
    integrate: [
      "List your actions and who may perform each. This table usually reveals gaps.",
      "Move scattered checks into one `can` function.",
      "Search for routes that load by id, and make sure each one checks the result.",
      "Write a test for each role and action, including the denials.",
      "Log denials: a spike often means someone is probing.",
    ],
    mistakes: [
      { title: "Checking the role but not the record", text: "This is IDOR, the classic. Any logged-in user can read any record by changing an id." },
      { title: "Authorization only in the UI", text: "Hidden buttons stop nobody, since attackers call your API directly." },
      { title: "Returning 403 across tenants", text: "It confirms the record exists. Use 404." },
      { title: "Trusting a role sent by the client", text: "Roles must come from your database or a signed token, never from a body or header." },
      { title: "Forgetting list endpoints", text: "`GET /docs` must filter too. A single-record check does nothing there." },
    ],
  },
  simulate: {
    intro: "Build any request and see exactly which check decides it.",
    preset: "auth",
    lab: "authz",
    labIntro: "Change any option, and the decision updates. Try to find a way for an admin to reach another tenant's document.",
    tries: [
      "Rejected requests cost little here: the auth check runs before any database work.",
      "Compare this with putting all checks after the database call. Ordering gates cheapest-first saves real capacity.",
    ],
  },
  sources: [
    { label: "OWASP Top 10: Broken Access Control", url: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/" },
    { label: "OWASP Authorization Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html" },
  ],
};
