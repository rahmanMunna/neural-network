/**
 * A discrete-event simulation of a backend. Nothing here is scripted: requests
 * are generated, wait for capacity and call each other, and queues, cache hit
 * rates and timeouts emerge from that. Time is simulated milliseconds.
 *
 * The rules each component follows are written to match how the real software
 * behaves, and are described next to each handler.
 */

export type Kind =
  | "client" | "dns" | "cdn" | "lb" | "limiter" | "auth" | "api"
  | "redis" | "db" | "queue" | "worker" | "storage";

export interface NodeParams {
  // client
  rps?: number;
  readShare?: number;
  writeShare?: number;
  uploadShare?: number;
  keys?: number;
  // shared capacity model
  concurrency?: number;
  serviceMs?: number;
  writeMs?: number;
  maxQueue?: number;
  // redis and cdn
  ttlMs?: number;
  maxKeys?: number;
  // limiter
  algorithm?: "fixed" | "sliding" | "token";
  limit?: number;
  windowMs?: number;
  perClient?: boolean;
  // auth
  rejectShare?: number;
  // worker
  failShare?: number;
  attempts?: number;
  backoffMs?: number;
  // storage
  drives?: number;
  parity?: number;
  failedDrives?: number;
}

export interface SimNode {
  id: string;
  kind: Kind;
  label: string;
  x: number;
  y: number;
  params: NodeParams;
  down?: boolean;
}

export interface SimEdge {
  from: string;
  to: string;
}

export interface Graph {
  nodes: SimNode[];
  edges: SimEdge[];
}

export type HopTone = "request" | "response" | "job" | "error";

export interface HopEvent {
  from: string;
  to: string;
  tone: HopTone;
  ms: number;
}

export type RequestType = "read" | "write" | "upload";

const CLIENT_TIMEOUT_MS = 5_000;
const LINK_MS = 2;
const CLIENT_LINK_MS = 15;
const DNS_TTL_MS = 30_000;

export const DEFAULTS: Record<Kind, NodeParams> = {
  client: { rps: 100, readShare: 0.8, writeShare: 0.15, uploadShare: 0.05, keys: 500 },
  dns: { concurrency: 50, serviceMs: 20 },
  cdn: { concurrency: 2000, serviceMs: 2, ttlMs: 60_000, maxKeys: 5000 },
  lb: { concurrency: 10000, serviceMs: 1 },
  limiter: { concurrency: 5000, serviceMs: 1, algorithm: "token", limit: 100, windowMs: 1000, perClient: false },
  auth: { concurrency: 200, serviceMs: 3, rejectShare: 0.02 },
  api: { concurrency: 100, serviceMs: 8, maxQueue: 500 },
  redis: { concurrency: 5000, serviceMs: 0.5, ttlMs: 30_000, maxKeys: 400 },
  db: { concurrency: 20, serviceMs: 15, writeMs: 30, maxQueue: 500 },
  queue: { concurrency: 5000, serviceMs: 0.5 },
  worker: { concurrency: 5, serviceMs: 200, failShare: 0.1, attempts: 3, backoffMs: 1000 },
  storage: { concurrency: 50, serviceMs: 120, drives: 4, parity: 2, failedDrives: 0 },
};

/** Mulberry32, so a run can be repeated exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small binary heap keyed by time. */
class Events {
  private heap: { at: number; seq: number; run: () => void }[] = [];
  private seq = 0;
  get size() {
    return this.heap.length;
  }
  get nextAt() {
    return this.heap[0]?.at ?? Infinity;
  }
  push(at: number, run: () => void) {
    const h = this.heap;
    h.push({ at, seq: this.seq++, run });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) {
        [h[i], h[p]] = [h[p]!, h[i]!];
        i = p;
      } else break;
    }
  }
  pop() {
    const h = this.heap;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(l, m)) m = l;
        if (r < h.length && this.less(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number) {
    const x = this.heap[a]!;
    const y = this.heap[b]!;
    return x.at !== y.at ? x.at < y.at : x.seq < y.seq;
  }
}

/** A server pool: at most `concurrency` at work, the rest wait in FIFO order. */
class Pool {
  busy = 0;
  waiting: (() => void)[] = [];
  concurrency: number;
  maxQueue: number;
  constructor(concurrency: number, maxQueue: number) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
  }
  /** False means the waiting line is full and the work was shed. */
  acquire(start: () => void) {
    if (this.busy < this.concurrency) {
      this.busy++;
      start();
      return true;
    }
    if (this.waiting.length >= this.maxQueue) return false;
    this.waiting.push(start);
    return true;
  }
  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.busy--;
  }
}

/** Keeps the most recently used keys, each with an expiry time. */
class Cache {
  entries = new Map<number, number>();
  ttlMs: number;
  maxKeys: number;
  constructor(ttlMs: number, maxKeys: number) {
    this.ttlMs = ttlMs;
    this.maxKeys = maxKeys;
  }
  has(key: number, now: number) {
    const expires = this.entries.get(key);
    if (expires === undefined) return false;
    if (expires <= now) {
      this.entries.delete(key);
      return false;
    }
    this.entries.delete(key);
    this.entries.set(key, expires);
    return true;
  }
  set(key: number, now: number) {
    this.entries.delete(key);
    this.entries.set(key, now + this.ttlMs);
    if (this.entries.size > this.maxKeys) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
  delete(key: number) {
    this.entries.delete(key);
  }
}

interface LimiterState {
  count: number;
  windowStart: number;
  log: number[];
  tokens: number;
  last: number;
}

interface Job {
  id: number;
  attempt: number;
}

interface Req {
  id: number;
  type: RequestType;
  key: number;
  client: string;
  start: number;
  timedOut: boolean;
  finished: boolean;
}

export interface NodeStats {
  /** Share of capacity in use, 0 to 1, over the recent window. */
  utilization: number;
  queued: number;
  busy: number;
  handled: number;
  errors: number;
  // queue only
  waiting?: number;
  active?: number;
  delayed?: number;
  completed?: number;
  failed?: number;
  // redis and cdn
  hits?: number;
  misses?: number;
  keys?: number;
}

export interface Snapshot {
  now: number;
  /** Totals over the recent window, per second. */
  throughput: number;
  errorRate: number;
  p50: number;
  p95: number;
  cacheHitRate: number | null;
  queueDepth: number;
  totals: {
    sent: number;
    ok: number;
    timeouts: number;
    byStatus: Record<string, number>;
    jobsAdded: number;
    jobsCompleted: number;
    jobsFailed: number;
  };
  nodes: Record<string, NodeStats>;
  clients: Record<string, { ok: number; denied: number }>;
}

const WINDOW_MS = 3_000;
const ok = (status: number) => status >= 200 && status < 300;

type Done = (status: number) => void;

export class Simulation {
  now = 0;
  private events = new Events();
  private random: () => number;
  private nodes = new Map<string, SimNode>();
  private out = new Map<string, string[]>();
  private pools = new Map<string, Pool>();
  private caches = new Map<string, Cache>();
  private limiters = new Map<string, Map<string, LimiterState>>();
  private cursor = new Map<string, number>();
  private dnsFresh = new Map<string, number>();
  private jobs = new Map<string, { waiting: Job[]; delayed: number; active: number }>();
  private recent: { at: number; latency: number; ok: boolean; client: string }[] = [];
  private busySamples = new Map<string, { at: number; busy: number }[]>();
  private stats = new Map<string, NodeStats>();
  private nextId = 1;
  private byStatus: Record<string, number> = {};
  private sent = 0;
  private okCount = 0;
  private timeouts = 0;
  private jobsAdded = 0;
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private recentHits: { at: number; hit: boolean }[] = [];
  private lastSample = 0;
  onHop?: (hop: HopEvent) => void;

  constructor(graph: Graph, seed = 1) {
    this.random = rng(seed);
    this.load(graph);
    for (const node of graph.nodes) {
      if (node.kind === "client") this.scheduleArrival(node.id);
      if (node.kind === "queue") this.jobs.set(node.id, { waiting: [], delayed: 0, active: 0 });
    }
  }

  /** Applies edited settings to a running simulation, keeping its state. */
  load(graph: Graph) {
    this.nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    this.out = new Map(graph.nodes.map((n) => [n.id, []]));
    for (const e of graph.edges) {
      if (this.nodes.has(e.from) && this.nodes.has(e.to)) this.out.get(e.from)!.push(e.to);
    }
    for (const n of graph.nodes) {
      const d = DEFAULTS[n.kind];
      const conc = n.params.concurrency ?? d.concurrency ?? 1;
      const maxQueue = n.params.maxQueue ?? d.maxQueue ?? 100_000;
      const pool = this.pools.get(n.id);
      if (pool) {
        pool.concurrency = conc;
        pool.maxQueue = maxQueue;
      } else {
        this.pools.set(n.id, new Pool(conc, maxQueue));
      }
      if (n.kind === "redis" || n.kind === "cdn") {
        const cache = this.caches.get(n.id);
        const ttl = n.params.ttlMs ?? d.ttlMs!;
        const max = n.params.maxKeys ?? d.maxKeys!;
        if (cache) {
          cache.ttlMs = ttl;
          cache.maxKeys = max;
        } else {
          this.caches.set(n.id, new Cache(ttl, max));
        }
      }
      if (!this.stats.has(n.id)) this.stats.set(n.id, { utilization: 0, queued: 0, busy: 0, handled: 0, errors: 0 });
      if (n.kind === "queue" && !this.jobs.has(n.id)) this.jobs.set(n.id, { waiting: [], delayed: 0, active: 0 });
    }
  }

  private p<K extends keyof NodeParams>(node: SimNode, key: K): NonNullable<NodeParams[K]> {
    return (node.params[key] ?? DEFAULTS[node.kind][key]) as NonNullable<NodeParams[K]>;
  }

  /** Exponential service times, the standard model for variable work. */
  private serviceTime(mean: number) {
    return -Math.log(1 - this.random()) * mean;
  }

  private link(a: string, b: string, tone: HopTone) {
    const ms = this.nodes.get(a)?.kind === "client" || this.nodes.get(b)?.kind === "client" ? CLIENT_LINK_MS : LINK_MS;
    this.onHop?.({ from: a, to: b, tone, ms });
    return ms;
  }

  private neighbours(id: string, kinds: Kind[]) {
    return (this.out.get(id) ?? []).filter((n) => kinds.includes(this.nodes.get(n)!.kind));
  }

  /** Call `to` from `from` over the network, including the reply. */
  private call(from: string, to: string, req: Req, tone: HopTone, then: Done) {
    this.events.push(this.now + this.link(from, to, tone), () =>
      this.visit(to, req, (status) => {
        this.events.push(this.now + this.link(to, from, ok(status) ? "response" : "error"), () => then(status));
      }),
    );
  }

  private scheduleArrival(clientId: string) {
    const client = this.nodes.get(clientId);
    if (!client) return;
    const rps = Math.max(0.01, this.p(client, "rps"));
    this.events.push(this.now + this.serviceTime(1000 / rps), () => {
      if (this.nodes.has(clientId)) {
        this.startRequest(clientId);
        this.scheduleArrival(clientId);
      }
    });
  }

  private pickType(client: SimNode): RequestType {
    const read = this.p(client, "readShare");
    const write = this.p(client, "writeShare");
    const upload = this.p(client, "uploadShare");
    const r = this.random() * (read + write + upload || 1);
    if (r < read) return "read";
    return r < read + write ? "write" : "upload";
  }

  /** Popularity follows a power curve: a few keys get most of the traffic. */
  private pickKey(client: SimNode) {
    return Math.floor(this.p(client, "keys") * this.random() ** 3);
  }

  private startRequest(clientId: string) {
    const client = this.nodes.get(clientId)!;
    const req: Req = {
      id: this.nextId++,
      type: this.pickType(client),
      key: this.pickKey(client),
      client: clientId,
      start: this.now,
      timedOut: false,
      finished: false,
    };
    this.sent++;

    const finish = (status: number) => {
      if (req.finished) return;
      req.finished = true;
      const key = String(status);
      this.byStatus[key] = (this.byStatus[key] ?? 0) + 1;
      if (ok(status)) this.okCount++;
      this.recent.push({ at: this.now, latency: this.now - req.start, ok: ok(status), client: clientId });
    };

    this.events.push(this.now + CLIENT_TIMEOUT_MS, () => {
      if (!req.finished) {
        req.timedOut = true;
        this.timeouts++;
        finish(504);
      }
    });

    const targets = (this.out.get(clientId) ?? []).filter((n) => this.nodes.get(n)!.kind !== "dns");
    const entry = targets[0];
    if (!entry) return finish(503);

    const send = () => this.call(clientId, entry, req, "request", finish);
    const dns = this.neighbours(clientId, ["dns"])[0];
    if (dns && (this.dnsFresh.get(clientId) ?? -1) <= this.now) {
      // A resolver answer is cached until its TTL, so most requests skip this.
      this.dnsFresh.set(clientId, this.now + DNS_TTL_MS);
      this.call(clientId, dns, req, "request", send);
    } else {
      send();
    }
  }

  private count(id: string, status: number) {
    const s = this.stats.get(id);
    if (!s) return;
    s.handled++;
    if (!ok(status)) s.errors++;
  }

  /** One component handling one request. */
  private visit(id: string, req: Req, done: Done) {
    const node = this.nodes.get(id);
    if (!node || node.down) return done(503);
    const finish: Done = (status) => {
      this.count(id, status);
      done(status);
    };
    switch (node.kind) {
      case "dns":
        return this.timed(node, this.p(node, "serviceMs"), finish, () => finish(200));
      case "cdn":
        return this.cdn(node, req, finish);
      case "lb":
        return this.timed(node, this.p(node, "serviceMs"), finish, () => this.balance(node, req, finish));
      case "limiter":
        return this.timed(node, this.p(node, "serviceMs"), finish, () => {
          if (!this.allow(node, req)) return finish(429);
          this.forward(node, req, finish);
        });
      case "auth":
        return this.timed(node, this.p(node, "serviceMs"), finish, () => {
          if (this.random() < this.p(node, "rejectShare")) return finish(401);
          this.forward(node, req, finish);
        });
      case "api":
        return this.api(node, req, finish);
      default:
        return finish(500);
    }
  }

  /** Occupies one slot of the node for `ms`, or sheds the work if full. */
  private timed(node: SimNode, ms: number, shed: Done, then: () => void) {
    const pool = this.pools.get(node.id)!;
    const accepted = pool.acquire(() => {
      this.events.push(this.now + this.serviceTime(ms), () => {
        pool.release();
        then();
      });
    });
    if (!accepted) shed(503);
  }

  /** Round robin across downstream nodes, skipping any that are down. */
  private balance(node: SimNode, req: Req, done: Done) {
    const targets = (this.out.get(node.id) ?? []).filter((n) => !this.nodes.get(n)!.down);
    if (!targets.length) return done(503);
    const at = this.cursor.get(node.id) ?? 0;
    this.cursor.set(node.id, at + 1);
    this.call(node.id, targets[at % targets.length]!, req, "request", done);
  }

  /** Limiters and auth pass the request to whatever sits behind them. */
  private forward(node: SimNode, req: Req, done: Done) {
    const next = (this.out.get(node.id) ?? [])[0];
    if (!next) return done(200);
    this.call(node.id, next, req, "request", done);
  }

  private cdn(node: SimNode, req: Req, done: Done) {
    this.timed(node, this.p(node, "serviceMs"), done, () => {
      const cache = this.caches.get(node.id)!;
      const stats = this.stats.get(node.id)!;
      if (req.type === "read" && cache.has(req.key, this.now)) {
        stats.hits = (stats.hits ?? 0) + 1;
        this.recentHits.push({ at: this.now, hit: true });
        return done(200);
      }
      if (req.type === "read") {
        stats.misses = (stats.misses ?? 0) + 1;
        this.recentHits.push({ at: this.now, hit: false });
      }
      this.forward(node, req, (status) => {
        if (req.type === "read" && ok(status)) cache.set(req.key, this.now);
        done(status);
      });
    });
  }

  private allow(node: SimNode, req: Req) {
    const scope = this.p(node, "perClient") ? req.client : "*";
    const states = this.limiters.get(node.id) ?? new Map<string, LimiterState>();
    this.limiters.set(node.id, states);
    const limit = this.p(node, "limit");
    const windowMs = this.p(node, "windowMs");
    const s = states.get(scope) ?? { count: 0, windowStart: 0, log: [], tokens: limit, last: this.now };
    states.set(scope, s);

    switch (this.p(node, "algorithm")) {
      case "fixed": {
        const window = Math.floor(this.now / windowMs) * windowMs;
        if (window !== s.windowStart) {
          s.windowStart = window;
          s.count = 0;
        }
        s.count++;
        return s.count <= limit;
      }
      case "sliding": {
        const from = this.now - windowMs;
        while (s.log.length && s.log[0]! <= from) s.log.shift();
        if (s.log.length >= limit) return false;
        s.log.push(this.now);
        return true;
      }
      case "token": {
        const rate = limit / windowMs;
        s.tokens = Math.min(limit, s.tokens + (this.now - s.last) * rate);
        s.last = this.now;
        if (s.tokens < 1) return false;
        s.tokens -= 1;
        return true;
      }
    }
  }

  /**
   * An API server holds a slot for the whole request, including time spent
   * waiting on its dependencies. That is why a slow database backs up the API.
   */
  private api(node: SimNode, req: Req, done: Done) {
    const pool = this.pools.get(node.id)!;
    const accepted = pool.acquire(() => {
      const release: Done = (status) => {
        pool.release();
        done(status);
      };
      this.events.push(this.now + this.serviceTime(this.p(node, "serviceMs")), () => {
        const peers = this.neighbours(node.id, ["api", "lb", "auth", "limiter"]);
        const callPeers = (i: number) => {
          const peer = peers[i];
          if (peer === undefined) return this.business(node, req, release);
          this.call(node.id, peer, req, "request", (status) => {
            if (!ok(status)) return release(status);
            callPeers(i + 1);
          });
        };
        callPeers(0);
      });
    });
    if (!accepted) done(503);
  }

  private business(node: SimNode, req: Req, done: Done) {
    const db = this.neighbours(node.id, ["db"])[0];
    const redis = this.neighbours(node.id, ["redis"])[0];
    const queue = this.neighbours(node.id, ["queue"])[0];
    const storage = this.neighbours(node.id, ["storage"])[0];
    const hasPeers = this.neighbours(node.id, ["api", "lb"]).length > 0;

    if (req.type === "upload") {
      if (storage) return this.store(node.id, storage, req, done);
      if (db) return this.database(node.id, db, req, true, done);
      return done(hasPeers ? 200 : 500);
    }

    if (req.type === "read") {
      if (redis) return this.readThroughCache(node.id, redis, db, req, done);
      if (db) return this.database(node.id, db, req, false, done);
      return done(hasPeers ? 200 : 500);
    }

    // Write: database first, then invalidate the cache, then queue side work.
    const afterDb: Done = (status) => {
      if (!ok(status)) return done(status);
      const afterCache = () => {
        if (!queue) return done(200);
        this.enqueue(node.id, queue, req, done);
      };
      if (!redis) return afterCache();
      // The write already committed, so a failed invalidation must not fail it.
      this.redisCall(node.id, redis, req, (cache) => {
        cache.delete(req.key);
        afterCache();
      }, afterCache);
    };
    if (db) return this.database(node.id, db, req, true, afterDb);
    if (queue) return this.enqueue(node.id, queue, req, done);
    done(hasPeers ? 200 : 500);
  }

  private redisCall(from: string, id: string, req: Req, use: (cache: Cache) => void, fail: Done) {
    const node = this.nodes.get(id)!;
    this.events.push(this.now + this.link(from, id, "request"), () => {
      if (node.down) {
        this.count(id, 503);
        this.events.push(this.now + this.link(id, from, "error"), () => fail(503));
        return;
      }
      this.timed(node, this.p(node, "serviceMs"), fail, () => {
        use(this.caches.get(id)!);
        this.count(id, 200);
      });
    });
  }

  /** Cache-aside. If Redis fails, a resilient app falls back to the database. */
  private readThroughCache(from: string, id: string, db: string | undefined, req: Req, done: Done) {
    const node = this.nodes.get(id)!;
    const stats = this.stats.get(id)!;
    const load = () => {
      if (!db) return done(500);
      this.database(from, db, req, false, (status) => {
        if (ok(status) && !node.down) this.caches.get(id)!.set(req.key, this.now);
        done(status);
      });
    };
    this.events.push(this.now + this.link(from, id, "request"), () => {
      if (node.down) {
        this.count(id, 503);
        this.events.push(this.now + this.link(id, from, "error"), load);
        return;
      }
      this.timed(node, this.p(node, "serviceMs"), () => load(), () => {
        this.count(id, 200);
        const hit = this.caches.get(id)!.has(req.key, this.now);
        stats[hit ? "hits" : "misses"] = (stats[hit ? "hits" : "misses"] ?? 0) + 1;
        this.recentHits.push({ at: this.now, hit });
        this.events.push(this.now + this.link(id, from, "response"), () => (hit ? done(200) : load()));
      });
    });
  }

  private database(from: string, id: string, req: Req, write: boolean, done: Done) {
    const node = this.nodes.get(id)!;
    const reply: Done = (status) => {
      this.count(id, status);
      this.events.push(this.now + this.link(id, from, ok(status) ? "response" : "error"), () => done(status));
    };
    this.events.push(this.now + this.link(from, id, "request"), () => {
      if (node.down) return reply(503);
      this.timed(node, write ? this.p(node, "writeMs") : this.p(node, "serviceMs"), reply, () => reply(200));
    });
  }

  /** Reads need `drives - parity` shards. Writes need one more when split evenly. */
  private store(from: string, id: string, req: Req, done: Done) {
    const node = this.nodes.get(id)!;
    const reply: Done = (status) => {
      this.count(id, status);
      this.events.push(this.now + this.link(id, from, ok(status) ? "response" : "error"), () => done(status));
    };
    this.events.push(this.now + this.link(from, id, "request"), () => {
      if (node.down) return reply(503);
      const drives = this.p(node, "drives");
      const parity = this.p(node, "parity");
      const failed = this.p(node, "failedDrives");
      if (!storageAvailable(drives, parity, failed).write) return reply(503);
      this.timed(node, this.p(node, "serviceMs"), reply, () => reply(200));
    });
  }

  private enqueue(from: string, id: string, req: Req, done: Done) {
    const node = this.nodes.get(id)!;
    const reply: Done = (status) => {
      this.count(id, status);
      this.events.push(this.now + this.link(id, from, ok(status) ? "response" : "error"), () => done(status));
    };
    this.events.push(this.now + this.link(from, id, "job"), () => {
      if (node.down) return reply(503);
      this.timed(node, this.p(node, "serviceMs"), reply, () => {
        this.jobsAdded++;
        this.jobs.get(id)!.waiting.push({ id: req.id, attempt: 1 });
        this.dispatch(id);
        reply(200);
      });
    });
  }

  /** Workers pull from the queue whenever they have a free slot. */
  private dispatch(queueId: string) {
    const state = this.jobs.get(queueId);
    if (!state) return;
    for (const workerId of this.neighbours(queueId, ["worker"])) {
      const worker = this.nodes.get(workerId)!;
      if (worker.down) continue;
      const pool = this.pools.get(workerId)!;
      while (state.waiting.length && pool.busy < pool.concurrency) {
        const job = state.waiting.shift()!;
        state.active++;
        pool.busy++;
        this.events.push(this.now + this.link(queueId, workerId, "job"), () => this.process(queueId, workerId, job));
      }
    }
  }

  private process(queueId: string, workerId: string, job: Job) {
    const state = this.jobs.get(queueId)!;
    const worker = this.nodes.get(workerId);
    const pool = this.pools.get(workerId)!;
    const free = () => {
      pool.busy--;
      state.active--;
      this.dispatch(queueId);
    };
    if (!worker) return free();
    this.events.push(this.now + this.serviceTime(this.p(worker, "serviceMs")), () => {
      const failed = worker.down || this.random() < this.p(worker, "failShare");
      if (!failed) {
        this.jobsCompleted++;
        this.count(workerId, 200);
        return free();
      }
      this.count(workerId, 500);
      if (job.attempt >= this.p(worker, "attempts")) {
        this.jobsFailed++;
        return free();
      }
      // Exponential backoff: the job sits in delayed, then returns to waiting.
      const delay = this.p(worker, "backoffMs") * 2 ** (job.attempt - 1);
      state.delayed++;
      this.events.push(this.now + delay, () => {
        state.delayed--;
        state.waiting.push({ id: job.id, attempt: job.attempt + 1 });
        this.dispatch(queueId);
      });
      free();
    });
  }

  /** Advances simulated time, running everything due on the way. */
  advance(ms: number) {
    const end = this.now + ms;
    while (this.events.nextAt <= end) {
      const e = this.events.pop();
      this.now = e.at;
      e.run();
      if (this.now - this.lastSample >= 100) this.sample();
    }
    this.now = end;
    this.sample();
  }

  private sample() {
    this.lastSample = this.now;
    for (const [id, pool] of this.pools) {
      const list = this.busySamples.get(id) ?? [];
      list.push({ at: this.now, busy: pool.busy });
      while (list.length && list[0]!.at < this.now - WINDOW_MS) list.shift();
      this.busySamples.set(id, list);
    }
    const from = this.now - WINDOW_MS;
    while (this.recent.length && this.recent[0]!.at < from) this.recent.shift();
    while (this.recentHits.length && this.recentHits[0]!.at < from) this.recentHits.shift();
  }

  snapshot(): Snapshot {
    const span = Math.min(this.now, WINDOW_MS) / 1000 || 1;
    const lat = this.recent.filter((r) => r.ok).map((r) => r.latency).sort((a, b) => a - b);
    const pct = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))]! : 0);
    const failed = this.recent.filter((r) => !r.ok).length;
    const hits = this.recentHits.filter((h) => h.hit).length;

    const nodes: Record<string, NodeStats> = {};
    for (const [id, base] of this.stats) {
      const pool = this.pools.get(id);
      if (!pool || !this.nodes.has(id)) continue;
      const samples = this.busySamples.get(id) ?? [];
      const avgBusy = samples.reduce((s, x) => s + x.busy, 0) / (samples.length || 1);
      const q = this.jobs.get(id);
      const cache = this.caches.get(id);
      nodes[id] = {
        ...base,
        utilization: Math.min(1, avgBusy / pool.concurrency),
        queued: pool.waiting.length,
        busy: pool.busy,
        ...(q ? { waiting: q.waiting.length, active: q.active, delayed: q.delayed, completed: this.jobsCompleted, failed: this.jobsFailed } : {}),
        ...(cache ? { keys: cache.entries.size } : {}),
      };
    }

    const clients: Snapshot["clients"] = {};
    for (const r of this.recent) {
      const c = (clients[r.client] ??= { ok: 0, denied: 0 });
      if (r.ok) c.ok++;
      else c.denied++;
    }
    for (const c of Object.values(clients)) {
      c.ok /= span;
      c.denied /= span;
    }

    let queueDepth = 0;
    for (const q of this.jobs.values()) queueDepth += q.waiting.length + q.delayed;

    return {
      now: this.now,
      throughput: (this.recent.length - failed) / span,
      errorRate: this.recent.length ? failed / this.recent.length : 0,
      p50: pct(0.5),
      p95: pct(0.95),
      cacheHitRate: this.recentHits.length ? hits / this.recentHits.length : null,
      queueDepth,
      totals: {
        sent: this.sent,
        ok: this.okCount,
        timeouts: this.timeouts,
        byStatus: { ...this.byStatus },
        jobsAdded: this.jobsAdded,
        jobsCompleted: this.jobsCompleted,
        jobsFailed: this.jobsFailed,
      },
      nodes,
      clients,
    };
  }

  /** Requests and jobs still inside the system, for conservation checks. */
  get inFlight() {
    return this.sent - Object.values(this.byStatus).reduce((a, b) => a + b, 0);
  }

  get jobsInSystem() {
    let n = 0;
    for (const q of this.jobs.values()) n += q.waiting.length + q.delayed + q.active;
    return n;
  }
}

/**
 * Availability of an erasure-coded set. Measured on RustFS 1.0.4 with 4 drives
 * (2 data, 2 parity): reads survive 2 failures, writes survive 1. Writes need
 * one extra shard when data and parity are equal, which prevents two halves of
 * a split cluster from each accepting different writes.
 */
export function storageAvailable(drives: number, parity: number, failed: number) {
  const data = drives - parity;
  const alive = drives - failed;
  return {
    data,
    read: alive >= data,
    write: alive >= (data === parity ? data + 1 : data),
  };
}

export interface Issue {
  level: "error" | "warning";
  text: string;
}

/** Plain-language problems with a design, shown before it even runs. */
export function validate(graph: Graph): Issue[] {
  const issues: Issue[] = [];
  const has = (k: Kind) => graph.nodes.filter((n) => n.kind === k);
  const out = (id: string) => graph.edges.filter((e) => e.from === id).map((e) => graph.nodes.find((n) => n.id === e.to)!).filter(Boolean);
  const into = (id: string) => graph.edges.filter((e) => e.to === id);

  if (!has("client").length) issues.push({ level: "error", text: "Add a Client: nothing is sending traffic." });
  for (const c of has("client")) {
    if (!out(c.id).some((n) => n.kind !== "dns")) issues.push({ level: "error", text: `${c.label} is not connected to anything.` });
  }
  for (const a of has("api")) {
    const kinds = out(a.id).map((n) => n.kind);
    if (!kinds.some((k) => ["db", "queue", "storage", "api", "lb"].includes(k))) {
      issues.push({ level: "warning", text: `${a.label} has no database, so reads and writes fail with 500.` });
    }
  }
  for (const r of has("redis")) {
    if (!into(r.id).length) issues.push({ level: "warning", text: `${r.label} is not used by any API.` });
  }
  for (const q of has("queue")) {
    if (!out(q.id).some((n) => n.kind === "worker")) {
      issues.push({ level: "warning", text: `${q.label} has no Worker, so jobs pile up forever.` });
    }
  }
  for (const w of has("worker")) {
    if (!into(w.id).length) issues.push({ level: "warning", text: `${w.label} has no queue to pull from.` });
  }
  for (const s of has("storage")) {
    const d = s.params.drives ?? DEFAULTS.storage.drives!;
    const p = s.params.parity ?? DEFAULTS.storage.parity!;
    if (p >= d) issues.push({ level: "error", text: `${s.label}: parity must be below the drive count.` });
  }
  return issues;
}

/** Which connections make sense, so the canvas can refuse the rest. */
export function canConnect(from: Kind, to: Kind) {
  if (to === "client") return false;
  if (from === to && from !== "api") return false;
  const allowed: Record<Kind, Kind[]> = {
    client: ["dns", "cdn", "lb", "limiter", "auth", "api"],
    dns: [],
    cdn: ["lb", "limiter", "auth", "api"],
    lb: ["limiter", "auth", "api"],
    limiter: ["lb", "auth", "api"],
    auth: ["lb", "limiter", "api"],
    api: ["api", "lb", "redis", "db", "queue", "storage", "auth", "limiter"],
    redis: [],
    db: [],
    queue: ["worker"],
    worker: [],
    storage: [],
  };
  return allowed[from].includes(to);
}
