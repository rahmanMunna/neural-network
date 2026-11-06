import assert from "node:assert/strict";
import { test } from "node:test";
import { canConnect, DEFAULTS, Simulation, storageAvailable, validate } from "./engine.ts";
import type { Graph, HopEvent, NodeParams, SimNode } from "./engine.ts";
import { PRESETS, presetById } from "./presets.ts";

const node = (id: string, kind: SimNode["kind"], params: NodeParams = {}): SimNode => ({
  id, kind, label: id, x: 0, y: 0, params,
});

const reads = { readShare: 1, writeShare: 0, uploadShare: 0 };
const writes = { readShare: 0, writeShare: 1, uploadShare: 0 };

function chain(nodes: SimNode[]): Graph {
  return { nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) };
}

function run(graph: Graph, seconds: number, seed = 1) {
  const sim = new Simulation(graph, seed);
  sim.advance(seconds * 1000);
  return sim;
}

test("every request and job is accounted for", () => {
  for (const preset of PRESETS) {
    const sim = run(preset.graph, 20);
    const s = sim.snapshot();
    const finished = Object.values(s.totals.byStatus).reduce((a, b) => a + b, 0);
    assert.equal(finished + sim.inFlight, s.totals.sent, preset.id);
    assert.equal(s.totals.ok, s.totals.byStatus["200"] ?? 0, preset.id);
    assert.equal(
      s.totals.jobsCompleted + s.totals.jobsFailed + sim.jobsInSystem,
      s.totals.jobsAdded,
      `${preset.id} jobs`,
    );
  }
});

test("the same seed reproduces a run exactly", () => {
  const a = run(presetById("full").graph, 10, 42).snapshot();
  const b = run(presetById("full").graph, 10, 42).snapshot();
  assert.deepEqual(a.totals, b.totals);
});

test("light load matches the arrival rate and has no queue", () => {
  const sim = run(chain([node("c", "client", { rps: 50, ...reads }), node("a", "api"), node("d", "db")]), 60);
  const s = sim.snapshot();
  assert.ok(Math.abs(s.totals.sent / 60 - 50) < 3, `rate ${s.totals.sent / 60}`);
  assert.equal(s.errorRate, 0);
  assert.equal(s.nodes["d"]!.queued, 0);
});

test("utilization follows queueing theory: load divided by capacity", () => {
  // 100 req/s at 15ms each on 20 connections: rho = 100 * 0.015 / 20 = 0.075.
  const sim = run(chain([node("c", "client", { rps: 100, ...reads }), node("a", "api"), node("d", "db")]), 60);
  const u = sim.snapshot().nodes["d"]!.utilization;
  assert.ok(Math.abs(u - 0.075) < 0.04, `utilization ${u}`);
});

test("throughput saturates at capacity: concurrency divided by service time", () => {
  // Capacity is 20 / 0.015s = 1333 req/s. Offer far more.
  const sim = run(
    chain([node("c", "client", { rps: 3000, ...reads }), node("a", "api", { concurrency: 2000, maxQueue: 100000 }), node("d", "db", { maxQueue: 100000 })]),
    30,
  );
  const s = sim.snapshot();
  assert.ok(s.throughput < 1333 * 1.1, `throughput ${s.throughput}`);
  assert.ok(s.nodes["d"]!.utilization > 0.95);
});

test("a saturated server builds a queue and latency climbs", () => {
  const graph = (rps: number) =>
    chain([node("c", "client", { rps, ...reads }), node("a", "api", { concurrency: 5000, maxQueue: 100000 }), node("d", "db", { maxQueue: 100000 })]);
  const fine = run(graph(500), 15).snapshot();
  const over = run(graph(1600), 15).snapshot();
  assert.ok(over.p50 > fine.p50 * 3, `${fine.p50} vs ${over.p50}`);
  assert.ok(over.nodes["d"]!.queued > 100);
});

test("a full queue sheds load with 503", () => {
  const sim = run(chain([node("c", "client", { rps: 2500, ...reads }), node("a", "api", { concurrency: 5000, maxQueue: 100000 }), node("d", "db", { maxQueue: 50 })]), 10);
  assert.ok((sim.snapshot().totals.byStatus["503"] ?? 0) > 100);
});

test("requests that wait too long time out with 504", () => {
  const sim = run(chain([node("c", "client", { rps: 2000, ...reads }), node("a", "api", { concurrency: 5000, maxQueue: 1000000 }), node("d", "db", { maxQueue: 1000000 })]), 30);
  assert.ok(sim.snapshot().totals.timeouts > 100);
});

test("redis absorbs reads, and the database sees far less", () => {
  const client = () => node("c", "client", { rps: 500, keys: 200, ...reads });
  const without = run(chain([client(), node("a", "api", { concurrency: 2000 }), node("d", "db")]), 30).snapshot();
  const withCache = run(
    { nodes: [client(), node("a", "api", { concurrency: 2000 }), node("r", "redis", { maxKeys: 1000 }), node("d", "db")], edges: [{ from: "c", to: "a" }, { from: "a", to: "r" }, { from: "a", to: "d" }] },
    30,
  ).snapshot();
  assert.ok(withCache.cacheHitRate! > 0.9, `hit ${withCache.cacheHitRate}`);
  assert.ok(withCache.nodes["d"]!.handled < without.nodes["d"]!.handled / 4);
  assert.ok(withCache.p50 < without.p50);
});

test("a short TTL lowers the hit rate", () => {
  const g = (ttlMs: number): Graph => ({
    nodes: [node("c", "client", { rps: 200, keys: 2000, ...reads }), node("a", "api"), node("r", "redis", { ttlMs, maxKeys: 5000 }), node("d", "db")],
    edges: [{ from: "c", to: "a" }, { from: "a", to: "r" }, { from: "a", to: "d" }],
  });
  assert.ok(run(g(200), 30).snapshot().cacheHitRate! < run(g(60000), 30).snapshot().cacheHitRate!);
});

test("when redis dies, the app falls back to the database", () => {
  const graph = presetById("cache").graph;
  const down: Graph = { ...graph, nodes: graph.nodes.map((n) => (n.kind === "redis" ? { ...n, down: true } : n)) };
  const s = run({ ...down, nodes: down.nodes.map((n) => (n.kind === "client" ? { ...n, params: { ...n.params, rps: 100 } } : n)) }, 15).snapshot();
  assert.ok(s.errorRate < 0.02, `errors ${s.errorRate}`);
});

test("each rate limit algorithm caps throughput near the limit", () => {
  for (const algorithm of ["fixed", "sliding", "token"] as const) {
    const sim = run(
      chain([node("c", "client", { rps: 1000, ...reads }), node("l", "limiter", { algorithm, limit: 100, windowMs: 1000 }), node("a", "api", { concurrency: 5000 }), node("d", "db", { concurrency: 500 })]),
      30,
    );
    const s = sim.snapshot();
    assert.ok(s.throughput <= 115 && s.throughput >= 85, `${algorithm}: ${s.throughput}`);
    assert.ok((s.totals.byStatus["429"] ?? 0) > 10000);
  }
});

test("limiter scope: a shared limit starves tenant A, a per-tenant limit protects it", () => {
  const preset = presetById("saas").graph;
  const scoped = (perClient: boolean): Graph => ({
    ...preset,
    nodes: preset.nodes.map((n) => (n.kind === "limiter" ? { ...n, params: { ...n.params, perClient } } : n)),
  });
  const shared = run(scoped(false), 30).snapshot();
  const fair = run(scoped(true), 30).snapshot();
  assert.ok(shared.clients["a"]!.ok < 15, `shared ${shared.clients["a"]!.ok}`);
  assert.ok(fair.clients["a"]!.ok > 25, `fair ${fair.clients["a"]!.ok}`);
});

test("a failed instance is routed around", () => {
  const graph = presetById("client-server").graph;
  const down = { ...graph, nodes: graph.nodes.map((n) => (n.id === "api1" ? { ...n, down: true } : n)) };
  const s = run(down, 20).snapshot();
  assert.equal(s.errorRate, 0);
  assert.equal(s.nodes["api1"]!.handled, 0);
});

test("jobs return immediately, while workers drain them later", () => {
  const graph = presetById("queue").graph;
  const s = run(graph, 30).snapshot();
  assert.ok(s.p50 < 150, `p50 ${s.p50}`);
  assert.ok(s.totals.jobsCompleted > 100);
});

test("failed jobs are retried, and only exhausted ones are lost", () => {
  const sim = run(
    chain([node("c", "client", { rps: 20, ...writes }), node("a", "api"), node("q", "queue"), node("w", "worker", { concurrency: 50, serviceMs: 20, failShare: 0.5, attempts: 3, backoffMs: 50 })]),
    60,
  );
  const s = sim.snapshot().totals;
  // At 50% per attempt, 1 in 8 jobs should fail all three attempts.
  const share = s.jobsFailed / (s.jobsFailed + s.jobsCompleted);
  assert.ok(Math.abs(share - 0.125) < 0.04, `failed share ${share}`);
});

test("too few workers makes the backlog grow without bound", () => {
  const backlog = (concurrency: number) =>
    run(chain([node("c", "client", { rps: 100, ...writes }), node("a", "api"), node("q", "queue"), node("w", "worker", { concurrency, serviceMs: 200, failShare: 0 })]), 30).snapshot().queueDepth;
  assert.ok(backlog(5) > 1000);
  assert.ok(backlog(60) < 20);
});

test("storage matches the failure rule measured on RustFS", () => {
  assert.deepEqual(storageAvailable(4, 2, 0), { data: 2, read: true, write: true });
  assert.deepEqual(storageAvailable(4, 2, 1), { data: 2, read: true, write: true });
  assert.deepEqual(storageAvailable(4, 2, 2), { data: 2, read: true, write: false });
  assert.deepEqual(storageAvailable(4, 2, 3), { data: 2, read: false, write: false });
});

test("uploads fail once storage loses write quorum", () => {
  const graph = (failedDrives: number): Graph => {
    const p = presetById("storage").graph;
    return { ...p, nodes: p.nodes.map((n) => (n.kind === "storage" ? { ...n, params: { ...n.params, failedDrives } } : n)) };
  };
  assert.equal(run(graph(1), 10).snapshot().errorRate, 0);
  assert.equal(run(graph(2), 10).snapshot().errorRate, 1);
});

test("a microservice chain is only as healthy as its weakest service", () => {
  const graph = presetById("microservices").graph;
  const down = { ...graph, nodes: graph.nodes.map((n) => (n.id === "pay" ? { ...n, down: true } : n)) };
  assert.equal(run(graph, 15).snapshot().errorRate, 0);
  assert.equal(run(down, 15).snapshot().errorRate, 1);
});

test("settings can change while running", () => {
  const graph = chain([node("c", "client", { rps: 50, ...reads }), node("a", "api"), node("d", "db")]);
  const sim = new Simulation(graph, 1);
  sim.advance(5000);
  graph.nodes[0]!.params.rps = 400;
  sim.load(graph);
  sim.advance(10000);
  assert.ok(sim.snapshot().throughput > 300);
});

test("hop events are emitted for the animation", () => {
  const hops: HopEvent[] = [];
  const sim = new Simulation(presetById("cache").graph, 1);
  sim.onHop = (h) => hops.push(h);
  sim.advance(1000);
  assert.ok(hops.some((h) => h.from === "client" && h.tone === "request"));
  assert.ok(hops.some((h) => h.tone === "response"));
});

test("validate explains broken designs", () => {
  assert.ok(validate({ nodes: [], edges: [] }).some((i) => i.text.includes("Add a Client")));
  const g = chain([node("c", "client"), node("a", "api")]);
  assert.ok(validate(g).some((i) => i.text.includes("no database")));
  assert.ok(validate({ nodes: [node("q", "queue")], edges: [] }).some((i) => i.text.includes("no Worker")));
});

test("all presets are valid designs", () => {
  for (const p of PRESETS) {
    assert.deepEqual(validate(p.graph).filter((i) => i.level === "error"), [], p.id);
    for (const e of p.graph.edges) {
      const from = p.graph.nodes.find((n) => n.id === e.from)!;
      const to = p.graph.nodes.find((n) => n.id === e.to)!;
      assert.ok(canConnect(from.kind, to.kind), `${p.id}: ${from.kind} -> ${to.kind}`);
    }
  }
});

test("defaults exist for every component", () => {
  for (const k of ["client", "dns", "cdn", "lb", "limiter", "auth", "api", "redis", "db", "queue", "worker", "storage"] as const) {
    assert.ok(DEFAULTS[k]);
  }
});

test("preset components never overlap on the narrowest canvas", () => {
  // Tiles are 112 by 56 on a canvas at least 720 by 500.
  const minDx = 112 / (720 - 112 - 16);
  const minDy = 56 / (500 - 56 - 16);
  for (const p of PRESETS) {
    for (let i = 0; i < p.graph.nodes.length; i++) {
      for (let j = i + 1; j < p.graph.nodes.length; j++) {
        const a = p.graph.nodes[i]!;
        const b = p.graph.nodes[j]!;
        const apart = Math.abs(a.x - b.x) >= minDx || Math.abs(a.y - b.y) >= minDy;
        assert.ok(apart, `${p.id}: ${a.label} overlaps ${b.label}`);
      }
    }
  }
});
