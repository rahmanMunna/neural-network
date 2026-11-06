import type { Graph, Kind, NodeParams, SimEdge, SimNode } from "./engine.ts";

const n = (id: string, kind: Kind, label: string, x: number, y: number, params: NodeParams = {}): SimNode => ({
  id, kind, label, x, y, params,
});

const links = (...pairs: string[]): SimEdge[] =>
  pairs.flatMap((chain) => {
    const parts = chain.split(">");
    return parts.slice(1).map((to, i) => ({ from: parts[i]!, to }));
  });

export interface Preset {
  id: string;
  label: string;
  graph: Graph;
}

const client = (rps: number, extra: NodeParams = {}) => n("client", "client", "Client", 0.04, 0.5, { rps, ...extra });

export const PRESETS: Preset[] = [
  {
    id: "full",
    label: "Full stack",
    graph: {
      nodes: [
        { ...client(120), x: 0 },
        n("dns", "dns", "DNS", 0, 0.12),
        n("cdn", "cdn", "CDN", 0.2, 0.5),
        n("lb", "lb", "Reverse proxy", 0.4, 0.5),
        n("api1", "api", "API 1", 0.6, 0.26),
        n("api2", "api", "API 2", 0.6, 0.74),
        n("redis", "redis", "Redis", 0.8, 0.04),
        n("db", "db", "Postgres", 0.8, 0.34),
        n("store", "storage", "RustFS", 0.8, 0.64),
        n("queue", "queue", "BullMQ", 0.8, 0.96),
        n("worker", "worker", "Worker", 1, 0.96),
      ],
      edges: links(
        "client>cdn>lb", "client>dns", "lb>api1", "lb>api2",
        "api1>redis", "api1>db", "api1>store", "api1>queue",
        "api2>redis", "api2>db", "api2>store", "api2>queue", "queue>worker",
      ),
    },
  },
  {
    id: "client-server",
    label: "Client and server",
    graph: {
      nodes: [
        client(40, { readShare: 0.9, writeShare: 0.1, uploadShare: 0 }),
        n("dns", "dns", "DNS", 0.04, 0.14),
        n("lb", "lb", "Reverse proxy", 0.34, 0.5),
        n("api1", "api", "API 1", 0.6, 0.3),
        n("api2", "api", "API 2", 0.6, 0.7),
        n("db", "db", "Postgres", 0.88, 0.5),
      ],
      edges: links("client>lb", "client>dns", "lb>api1>db", "lb>api2>db"),
    },
  },
  {
    id: "no-cache",
    label: "Database only",
    graph: {
      nodes: [
        client(600, { readShare: 0.95, writeShare: 0.05, uploadShare: 0 }),
        n("api", "api", "API", 0.42, 0.5, { concurrency: 400 }),
        n("db", "db", "Postgres", 0.84, 0.5),
      ],
      edges: links("client>api>db"),
    },
  },
  {
    id: "cache",
    label: "With Redis",
    graph: {
      nodes: [
        client(600, { readShare: 0.95, writeShare: 0.05, uploadShare: 0 }),
        n("api", "api", "API", 0.42, 0.5, { concurrency: 400 }),
        n("redis", "redis", "Redis", 0.84, 0.22),
        n("db", "db", "Postgres", 0.84, 0.78),
      ],
      edges: links("client>api>redis", "api>db"),
    },
  },
  {
    id: "queue",
    label: "Background jobs",
    graph: {
      nodes: [
        client(60, { readShare: 0, writeShare: 1, uploadShare: 0 }),
        n("api", "api", "API", 0.32, 0.5),
        n("queue", "queue", "BullMQ", 0.6, 0.5),
        n("w1", "worker", "Worker", 0.9, 0.5, { concurrency: 5, serviceMs: 200, failShare: 0.15, attempts: 3, backoffMs: 1000 }),
      ],
      edges: links("client>api>queue>w1"),
    },
  },
  {
    id: "storage",
    label: "File uploads",
    graph: {
      nodes: [
        client(30, { readShare: 0, writeShare: 0, uploadShare: 1 }),
        n("api", "api", "API", 0.42, 0.5),
        n("store", "storage", "RustFS", 0.84, 0.5, { drives: 4, parity: 2, failedDrives: 0 }),
      ],
      edges: links("client>api>store"),
    },
  },
  {
    id: "n-tier",
    label: "Three tiers",
    graph: {
      nodes: [
        client(150, { readShare: 0.8, writeShare: 0.2, uploadShare: 0 }),
        n("lb", "lb", "Web tier", 0.32, 0.5),
        n("api1", "api", "App server 1", 0.6, 0.28),
        n("api2", "api", "App server 2", 0.6, 0.72),
        n("db", "db", "Data tier", 0.9, 0.5),
      ],
      edges: links("client>lb", "lb>api1>db", "lb>api2>db"),
    },
  },
  {
    id: "monolith",
    label: "Monolith",
    graph: {
      nodes: [
        client(200, { readShare: 0.7, writeShare: 0.3, uploadShare: 0 }),
        n("lb", "lb", "Load balancer", 0.3, 0.5),
        n("api1", "api", "Monolith 1", 0.58, 0.28, { serviceMs: 15 }),
        n("api2", "api", "Monolith 2", 0.58, 0.72, { serviceMs: 15 }),
        n("db", "db", "Shared database", 0.88, 0.5),
      ],
      edges: links("client>lb", "lb>api1>db", "lb>api2>db"),
    },
  },
  {
    id: "microservices",
    label: "Microservices",
    graph: {
      nodes: [
        client(100, { readShare: 0.6, writeShare: 0.4, uploadShare: 0 }),
        n("gw", "lb", "API gateway", 0.24, 0.5),
        n("orders", "api", "Orders", 0.46, 0.5, { concurrency: 80 }),
        n("inv", "api", "Inventory", 0.7, 0.2),
        n("pay", "api", "Payments", 0.7, 0.8, { serviceMs: 40 }),
        n("db1", "db", "Orders DB", 0.46, 0.92),
        n("db2", "db", "Inventory DB", 0.94, 0.2),
        n("db3", "db", "Payments DB", 0.94, 0.8),
      ],
      edges: links("client>gw>orders", "orders>db1", "orders>inv>db2", "orders>pay>db3"),
    },
  },
  {
    id: "rate-limit",
    label: "Rate limiter",
    graph: {
      nodes: [
        client(300, { readShare: 1, writeShare: 0, uploadShare: 0 }),
        n("limit", "limiter", "Rate limiter", 0.36, 0.5, { algorithm: "token", limit: 100, windowMs: 1000 }),
        n("api", "api", "API", 0.64, 0.5),
        n("db", "db", "Postgres", 0.9, 0.5),
      ],
      edges: links("client>limit>api>db"),
    },
  },
  {
    id: "auth",
    label: "Auth gateway",
    graph: {
      nodes: [
        client(120, { readShare: 0.8, writeShare: 0.2, uploadShare: 0 }),
        n("auth", "auth", "Auth check", 0.36, 0.5, { rejectShare: 0.1 }),
        n("api", "api", "API", 0.64, 0.5),
        n("db", "db", "Postgres", 0.9, 0.5),
      ],
      edges: links("client>auth>api>db"),
    },
  },
  {
    id: "saas",
    label: "SaaS, noisy tenant",
    graph: {
      nodes: [
        n("a", "client", "Tenant A", 0.04, 0.22, { rps: 30, readShare: 0.9, writeShare: 0.1, uploadShare: 0 }),
        n("b", "client", "Tenant B (noisy)", 0.04, 0.78, { rps: 700, readShare: 0.9, writeShare: 0.1, uploadShare: 0 }),
        n("limit", "limiter", "Per-tenant limit", 0.34, 0.5, { algorithm: "token", limit: 50, windowMs: 1000, perClient: false }),
        n("api", "api", "API", 0.62, 0.5, { concurrency: 80 }),
        n("db", "db", "Shared Postgres", 0.9, 0.5),
      ],
      edges: links("a>limit", "b>limit", "limit>api>db"),
    },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
