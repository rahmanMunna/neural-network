import type { Graph, Snapshot } from "./engine.ts";

export interface Insight {
  tone: "good" | "warn" | "bad";
  text: string;
}

/** Turns live numbers into one plain sentence about what is happening right now. */
export function diagnose(graph: Graph, s: Snapshot): Insight {
  if (s.now < 1500) return { tone: "good", text: "Warming up. Numbers settle after a few seconds." };

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  const entries = Object.entries(s.nodes).filter(([id]) => byId.get(id)?.kind !== "client");

  const dead = graph.nodes.find((n) => n.down);
  const denied429 = s.totals.byStatus["429"] ?? 0;
  const total = s.totals.sent || 1;

  const saturated = entries
    .filter(([id, n]) => n.utilization > 0.85 && byId.get(id)?.kind !== "queue")
    .sort(([, a], [, b]) => b.utilization - a.utilization);

  // The furthest-downstream saturated component is the true bottleneck, because
  // everything in front of it is only busy waiting for it.
  const priority: Record<string, number> = { db: 4, storage: 4, worker: 3, redis: 3, api: 2, auth: 1, lb: 1, cdn: 1, limiter: 1 };
  const bottleneck = [...saturated].sort(
    ([a], [b]) => (priority[byId.get(b)!.kind] ?? 0) - (priority[byId.get(a)!.kind] ?? 0),
  )[0];

  if (s.queueDepth > 200) {
    return {
      tone: "warn",
      text: `Jobs are arriving faster than workers finish them. ${Math.round(s.queueDepth)} are waiting. Add worker concurrency, or the backlog keeps growing.`,
    };
  }
  if (bottleneck) {
    const [id, n] = bottleneck;
    return {
      tone: "bad",
      text: `${name(id)} is the bottleneck at ${Math.round(n.utilization * 100)}% capacity${n.queued ? `, with ${n.queued} waiting` : ""}. Everything in front of it is stuck waiting. Raise its capacity, or take load off it.`,
    };
  }
  if (dead && s.errorRate > 0.01) {
    return { tone: "bad", text: `${dead.label} is down and ${Math.round(s.errorRate * 100)}% of requests are failing.` };
  }
  if (dead) {
    return { tone: "warn", text: `${dead.label} is down, but the system is routing around it. Users notice nothing.` };
  }
  if (denied429 / total > 0.05) {
    return { tone: "warn", text: `The rate limiter is rejecting ${Math.round((denied429 / total) * 100)}% of requests with 429. The servers behind it stay healthy.` };
  }
  if (s.errorRate > 0.01) {
    return { tone: "bad", text: `${Math.round(s.errorRate * 100)}% of requests are failing. Check the status breakdown and what each server depends on.` };
  }
  if (s.cacheHitRate !== null && s.cacheHitRate > 0.8) {
    return { tone: "good", text: `The cache answers ${Math.round(s.cacheHitRate * 100)}% of reads, so the database only sees the rest.` };
  }
  return { tone: "good", text: "Healthy. Try raising traffic until something gives way." };
}
