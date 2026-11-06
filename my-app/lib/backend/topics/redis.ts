import type { FlowSpec } from "../flow.ts";
import type { Topic } from "../topic.ts";

const flow: FlowSpec = {
  nodes: [
    { id: "client", kind: "client", label: "Client", x: 0, y: 0.45 },
    { id: "api", kind: "api", label: "API server", sub: "ioredis", x: 0.38, y: 0.45 },
    { id: "redis", kind: "redis", label: "Redis", sub: "in memory", x: 0.88, y: 0.08 },
    { id: "db", kind: "db", label: "Postgres", sub: "on disk", x: 0.88, y: 0.82 },
    { id: "api2", kind: "api", label: "API server 2", sub: "same moment", x: 0.38, y: 1 },
  ],
  scenarios: [
    {
      id: "aside",
      label: "Cache-aside: miss, then hit",
      summary: "The most common Redis pattern. The application checks the cache first, and only goes to the database when the cache has nothing.",
      steps: [
        {
          phase: "Miss",
          title: "A request arrives, and the cache is empty",
          body: "The API asks Redis for `user:42`. Redis looks it up in memory and finds nothing. It answers `nil`, which costs a fraction of a millisecond.",
          hops: [["client", "api", "GET /users/42", "request"], ["api", "redis", "GET user:42", "request"], ["redis", "api", "nil", "response"]],
          code: "redis/cache.ts#cache-aside",
        },
        {
          phase: "Miss",
          title: "The database does the slow work",
          body: "This request pays the full price. Postgres finds the row, which takes milliseconds rather than microseconds.",
          hops: [["api", "db", "SELECT … id=42", "request"], ["db", "api", "{ name: Ada }", "response"]],
          card: { at: "db", title: "Postgres", tag: "source of truth", rows: ["plan: index scan on users_pkey", "read row from buffer or disk", { t: "about 5 ms", tone: "job" }] },
        },
        {
          phase: "Miss",
          title: "The result is saved with an expiry",
          body: "The API stores the value in Redis with a time to live. The small random spread stops thousands of keys from expiring in the same instant.",
          hops: [["api", "redis", "SET user:42 EX 57", "data"], ["api", "client", "200 { name: Ada }", "response"]],
          set: { redis: ["user:42  TTL 57s"] },
        },
        {
          phase: "Hit",
          title: "The next request never touches the database",
          body: "Same URL, a moment later. Redis has the value, so Postgres does nothing at all. This is where a cache earns its place: reads get faster, and the database gets room to breathe.",
          hops: [["client", "api", "GET /users/42", "request"], ["api", "redis", "GET user:42", "request"], ["redis", "api", "{ name: Ada }", "response"], ["api", "client", "200 in 2 ms", "response"]],
        },
      ],
    },
    {
      id: "write",
      label: "Keeping the cache correct",
      summary: "A cache is a copy, and copies go stale. The standard fix is simple: write to the database, then delete the cached key.",
      steps: [
        {
          phase: "Write",
          title: "The database is written first",
          body: "The name changes to Grace. The database is the source of truth, so it must succeed before anything else happens. Redis still holds the old name.",
          hops: [["client", "api", "PATCH /users/42", "request"], ["api", "db", "UPDATE name=Grace", "request"], ["db", "api", "COMMIT", "response"]],
          set: { redis: ["user:42 = Ada  (stale)"] },
          code: "redis/users.ts#usage",
        },
        {
          phase: "Invalidate",
          title: "The key is deleted, not updated",
          body: "Why delete rather than write the new value? With two concurrent writers, the updates can reach Redis in the opposite order to the database, leaving the wrong value cached. A delete cannot do that.",
          hops: [["api", "redis", "DEL user:42", "request"], ["api", "client", "200 OK", "response"]],
          set: { redis: null },
        },
        {
          phase: "Rebuild",
          title: "The next read fetches the truth",
          body: "The cache misses, the database returns Grace, and the fresh value is stored. The TTL is the safety net: even if a delete is lost, a stale value only lasts until it expires.",
          hops: [["client", "api", "GET /users/42", "request"], ["api", "redis", "GET user:42", "request"], ["redis", "api", "nil", "response"], ["api", "db", "SELECT", "request"], ["db", "api", "{ name: Grace }", "response"], ["api", "redis", "SET user:42 EX 62", "data"]],
          set: { redis: ["user:42 = Grace  TTL 62s"] },
        },
      ],
    },
    {
      id: "stampede",
      label: "Cache stampede",
      summary: "A popular key expires under heavy load. Without protection, every in-flight request hits the database at once. This has taken down real production systems.",
      steps: [
        {
          phase: "The problem",
          title: "A hot key expires",
          body: "This key serves 5,000 requests a second. At the moment it expires, every request misses together, and each one would run the same expensive query.",
          fan: [["client", "api", "many requests", "request"], ["client", "api2", "many requests", "request"]],
          set: { redis: ["hot:key  expired"] },
        },
        {
          phase: "The fix",
          title: "Only one request wins the lock",
          body: "`SET lock NX PX 5000` succeeds for exactly one caller, because Redis runs one command at a time. The `PX` expiry means a crashed process cannot hold the lock forever.",
          fan: [["api", "redis", "SET lock NX", "request"], ["api2", "redis", "SET lock NX", "request"]],
          card: { at: "redis", title: "Redis", tag: "one command at a time", rows: [{ t: "API 1: OK, lock acquired", tone: "response" }, { t: "API 2: nil, already taken", tone: "error" }] },
          code: "redis/cache.ts#lock",
        },
        {
          phase: "The fix",
          title: "The winner rebuilds. Everyone else waits",
          body: "One query reaches the database. The others poll Redis briefly instead of piling on. In the test for this guide, 100 concurrent callers produced exactly one rebuild.",
          hops: [["api", "db", "one SELECT", "request"], ["db", "api", "result", "response"], ["api", "redis", "SET hot:key", "data"], ["redis", "api2", "hot:key value", "response"]],
          set: { redis: ["hot:key  TTL 60s"] },
        },
      ],
    },
  ],
};

export const redis: Topic = {
  slug: "redis",
  title: "Redis",
  nav: "Redis",
  group: "Building blocks",
  lede: "An in-memory data store. It answers in under a millisecond, which makes it the standard tool for caching, sessions, rate limits, counters and queues.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Redis keeps data in RAM and speaks a simple command protocol over the network. Memory is thousands of times faster than disk, so one Redis server can handle very large numbers of commands per second." },
        { p: "It is more than a key-value store. A value can be a string, a hash, a list, a set, a sorted set or a stream. Each type has its own atomic commands, so many problems that need careful locking elsewhere become a single command." },
      ],
    },
    {
      heading: "What problem it solves",
      blocks: [
        { p: "Databases are built for durability and complex queries, which makes them comparatively slow. If 1,000 users load the same product page, running the same query 1,000 times is wasted work. Keep the answer in memory and serve it from there." },
        { p: "It also gives separate servers somewhere to share fast state. Once you run two API instances, a counter in one process's memory is wrong. Rate limits, sessions and locks need one shared place." },
      ],
    },
    {
      heading: "Why it is fast, and why that makes it safe",
      blocks: [
        { p: "Redis executes commands one at a time on a single thread. That sounds like a limit, but it is the key design choice. Because nothing runs in parallel, every command is atomic. `INCR` cannot lose an update, and `SET key value NX` cannot have two winners. A Lua script also runs from start to finish with nothing in between." },
        { callout: "A slow command blocks everyone. `KEYS *` on a large database stops the whole server until it finishes. Use `SCAN` in production.", title: "The cost of one thread" },
      ],
    },
    {
      heading: "Which data structure for which job",
      blocks: [
        {
          table: {
            head: ["Type", "Good for", "Example commands"],
            rows: [
              ["String", "Cached JSON, counters, locks", "GET, SET EX, INCR"],
              ["Hash", "Objects with named fields, sessions", "HSET, HGETALL"],
              ["Sorted set", "Leaderboards, sliding windows", "ZADD, ZREVRANGE"],
              ["List", "Simple queues", "LPUSH, BRPOP"],
              ["Set", "Unique members, tags", "SADD, SISMEMBER"],
              ["Stream", "Durable event logs", "XADD, XREADGROUP"],
            ],
          },
        },
      ],
    },
    {
      heading: "When not to use it",
      blocks: [
        {
          list: [
            "As your only copy of data you cannot lose. Persistence exists, but a cache that can be rebuilt is a far simpler system.",
            "When your data does not fit in memory. RAM is the most expensive way to store things.",
            "For complex queries. There are no joins. Keep that work in Postgres.",
            "To cache something that is already fast or rarely read. A cache adds a second copy to keep correct.",
          ],
        },
        { callout: "Set an eviction policy like `allkeys-lru` on a cache, so Redis drops old keys when memory fills. BullMQ needs the opposite, `noeviction`, because an evicted job is lost work. If you need both, run two Redis instances.", title: "Cache and queue want different settings" },
      ],
    },
  ],
  flow,
  build: {
    intro: "You will add a production-grade cache to a TypeScript service, including expiry jitter, invalidation, stampede protection and surviving a Redis outage. All of this code runs against a real Redis in this site's test suite.",
    needs: ["Node.js 20 or newer", "Docker Desktop, or any Redis server"],
    install: "npm install ioredis\ndocker run -d --name redis -p 6379:6379 redis:8-alpine",
    tree: "src/\n├─ redis/\n│  ├─ client.ts     one shared connection\n│  └─ cache.ts      cached(), cachedOnce()\n└─ users/\n   └─ service.ts    uses the cache",
    steps: [
      {
        title: "Create one shared client",
        explain: [
          "Create the client once and import it everywhere. ioredis sends all commands down one connection, so a client per request would only slow things down.",
          "`maxRetriesPerRequest: 1` matters more than it looks. The default retries each command 20 times, so a dead Redis would stall every request. A cache should fail fast.",
          "The `error` listener is required. Without one, a dropped connection raises an unhandled error and crashes the process.",
        ],
        code: "redis/client.ts#client",
        where: "Put this in `src/redis/client.ts` and read the URL from an environment variable.",
      },
      {
        title: "Add cache-aside",
        explain: [
          "`cached` takes a key, a lifetime and a function that loads the real data. Callers do not need to know about Redis at all.",
          "`jitter` varies each TTL by 10%. Without it, everything cached during one traffic spike also expires in one spike.",
          "A missing row is cached too, as `null`, with a short TTL. Otherwise requests for a record that does not exist hit the database every time, which is an easy way to attack a site.",
          "`safely` is what keeps your site up. If Redis is unreachable, the command fails and the request carries on to the database.",
        ],
        code: "redis/cache.ts#cache-aside",
        where: "Put this in `src/redis/cache.ts`.",
      },
      {
        title: "Use it, and invalidate on writes",
        explain: [
          "Reads go through the cache. Writes update the database first, then delete the key. Your database code does not change.",
          "The key name is built in one function. If reads and writes build keys separately, one typo means stale data with no error anywhere.",
        ],
        code: "redis/users.ts#usage",
        where: "This goes in your service layer, wrapping the calls you already make to the database.",
      },
      {
        title: "Protect hot keys from stampedes",
        explain: [
          "For very popular keys, use `cachedOnce` in place of `cached`. It adds a short lock, so one caller rebuilds while the others wait.",
          "The lock's value is a random token, and it is released by a Lua script that checks the token first. Without that check, a slow process could delete a lock that a different process now holds.",
          "If the wait runs out, it loads the data anyway. Serving a request slowly is better than failing it.",
        ],
        code: "redis/cache.ts#lock",
      },
      {
        title: "Beyond caching: counters, leaderboards, sessions",
        explain: [
          "`INCR` is atomic, so 200 concurrent increments in the tests always total exactly 200. `MULTI` makes sure the key can never exist without its expiry.",
          "A sorted set keeps its members ordered on every write, so a leaderboard is one command and needs no sorting.",
          "Hashes let you change one field of a session without rewriting all of it.",
        ],
        code: ["redis/patterns.ts#counter", "redis/patterns.ts#leaderboard", "redis/patterns.ts#session"],
      },
      {
        title: "Pub/sub, and when not to use it",
        explain: [
          "Publishing sends a message to whoever is subscribed right now, and nothing is stored. If a subscriber is restarting, it misses that message forever. Use this for things that are fine to lose, like live UI updates. If a message must be processed, use BullMQ.",
        ],
        code: "redis/patterns.ts#pubsub",
      },
    ],
    integrate: [
      "Pick your slowest frequent read from your logs. Cache that one thing first, and measure before and after.",
      "Wrap the existing database call in `cached()`. The function keeps its signature, so callers do not change.",
      "Find every place that writes that data, and add the `DEL`. This is the step people miss.",
      "Add a metric for the cache hit rate. A low rate means the cache adds a network call and saves nothing.",
      "Set `maxmemory` and an eviction policy before going live.",
    ],
    mistakes: [
      { title: "Updating the cache on write instead of deleting", text: "Concurrent writers can reach Redis in the opposite order to the database, which leaves the wrong value in place until the TTL ends." },
      { title: "No TTL", text: "Keys without an expiry stay forever. Any missed invalidation then becomes permanent stale data, and memory keeps growing." },
      { title: "Letting a Redis outage take the site down", text: "A cache is an optimisation, so catch its errors. But remember that the database then takes the full load, so it needs its own protection." },
      { title: "Releasing a lock without checking ownership", text: "If your lock expired and another process took it, a plain `DEL` removes their lock. Compare the token first, in one atomic script." },
      { title: "Using KEYS in production", text: "It blocks the single thread for the whole scan. Use `SCAN`." },
    ],
  },
  simulate: {
    intro: "Here is a read-heavy API with Redis in front of Postgres. Change how it is configured and watch the numbers respond.",
    preset: "cache",
    tries: [
      "Click Redis and press Take down. The hit rate disappears and the database takes the full load, yet requests still succeed.",
      "Drag the Key lifetime down to 1 second. The hit rate falls, because keys expire before they are read again.",
      "Lower Max keys in memory to 20. Now the cache is too small for the working set.",
      "Click Client and raise Writes. More writes means more invalidation and fewer hits.",
    ],
  },
  sources: [
    { label: "Redis documentation", url: "https://redis.io/docs/latest/" },
    { label: "Redis key eviction", url: "https://redis.io/docs/latest/develop/reference/eviction/" },
    { label: "ioredis", url: "https://github.com/redis/ioredis" },
  ],
};
