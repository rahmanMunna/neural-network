"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { DEFAULTS, Simulation, canConnect, storageAvailable, validate } from "@/lib/sim/engine";
import type { Graph, HopTone, Kind, NodeParams, SimNode, Snapshot } from "@/lib/sim/engine";
import { diagnose } from "@/lib/sim/diagnose";
import { PRESETS, presetById } from "@/lib/sim/presets";
import { Icon } from "./icons";
import type { IconKind } from "@/lib/backend/flow";

const PALETTE: { kind: Kind; label: string; icon: IconKind; note: string }[] = [
  { kind: "client", label: "Client", icon: "client", note: "Sends traffic" },
  { kind: "dns", label: "DNS", icon: "dns", note: "Name lookup" },
  { kind: "cdn", label: "CDN", icon: "cdn", note: "Edge cache" },
  { kind: "lb", label: "Load balancer", icon: "lb", note: "Reverse proxy" },
  { kind: "limiter", label: "Rate limiter", icon: "limiter", note: "Caps traffic" },
  { kind: "auth", label: "Auth", icon: "auth", note: "Checks tokens" },
  { kind: "api", label: "API server", icon: "api", note: "Your code" },
  { kind: "redis", label: "Redis", icon: "redis", note: "Cache" },
  { kind: "db", label: "Postgres", icon: "db", note: "Database" },
  { kind: "queue", label: "BullMQ", icon: "queue", note: "Job queue" },
  { kind: "worker", label: "Worker", icon: "worker", note: "Runs jobs" },
  { kind: "storage", label: "RustFS", icon: "storage", note: "Object storage" },
];

const iconOf = (kind: Kind) => PALETTE.find((p) => p.kind === kind)!.icon;

interface Field {
  key: keyof NodeParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  scale?: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ms = (v: number) => `${v} ms`;
const seconds = (v: number) => `${v / 1000} s`;

const FIELDS: Partial<Record<Kind, Field[]>> = {
  client: [
    { key: "rps", label: "Requests per second", min: 1, max: 3000, step: 1 },
    { key: "readShare", label: "Reads", min: 0, max: 1, step: 0.05, format: pct },
    { key: "writeShare", label: "Writes", min: 0, max: 1, step: 0.05, format: pct },
    { key: "uploadShare", label: "Uploads", min: 0, max: 1, step: 0.05, format: pct },
    { key: "keys", label: "Different records", min: 10, max: 20000, step: 10 },
  ],
  cdn: [
    { key: "ttlMs", label: "Cache lifetime", min: 1000, max: 300000, step: 1000, format: seconds },
    { key: "maxKeys", label: "Max objects", min: 10, max: 20000, step: 10 },
  ],
  limiter: [
    { key: "limit", label: "Limit per window", min: 1, max: 2000, step: 1 },
    { key: "windowMs", label: "Window", min: 100, max: 10000, step: 100, format: seconds },
  ],
  auth: [
    { key: "serviceMs", label: "Check time", min: 1, max: 100, step: 1, format: ms },
    { key: "rejectShare", label: "Invalid tokens", min: 0, max: 1, step: 0.01, format: pct },
  ],
  api: [
    { key: "concurrency", label: "Concurrent requests", min: 1, max: 2000, step: 1 },
    { key: "serviceMs", label: "CPU time per request", min: 1, max: 200, step: 1, format: ms },
  ],
  redis: [
    { key: "ttlMs", label: "Key lifetime (TTL)", min: 100, max: 300000, step: 100, format: seconds },
    { key: "maxKeys", label: "Max keys in memory", min: 10, max: 20000, step: 10 },
  ],
  db: [
    { key: "concurrency", label: "Connection pool", min: 1, max: 200, step: 1 },
    { key: "serviceMs", label: "Read time", min: 1, max: 200, step: 1, format: ms },
    { key: "writeMs", label: "Write time", min: 1, max: 500, step: 1, format: ms },
  ],
  worker: [
    { key: "concurrency", label: "Concurrency", min: 1, max: 200, step: 1 },
    { key: "serviceMs", label: "Job time", min: 5, max: 3000, step: 5, format: ms },
    { key: "failShare", label: "Failure rate", min: 0, max: 1, step: 0.01, format: pct },
    { key: "attempts", label: "Attempts", min: 1, max: 8, step: 1 },
    { key: "backoffMs", label: "First backoff", min: 50, max: 10000, step: 50, format: ms },
  ],
  storage: [
    { key: "drives", label: "Drives", min: 4, max: 16, step: 1 },
    { key: "parity", label: "Parity shards", min: 1, max: 8, step: 1 },
    { key: "failedDrives", label: "Failed drives", min: 0, max: 16, step: 1 },
    { key: "concurrency", label: "Concurrent uploads", min: 1, max: 500, step: 1 },
  ],
};

const NODE_W = 112;
const NODE_H = 56;
const CANVAS_H = 500;

const toneColor: Record<HopTone, string> = {
  request: "--signal",
  response: "--update",
  job: "--grad",
  error: "--loss",
};

interface Particle {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t: number;
  color: string;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[76px] flex-1 border-l border-[var(--line)] pl-3 first:border-l-0 first:pl-0">
      <div className="text-[11px] whitespace-nowrap text-[var(--muted)]">{label}</div>
      <div className="stage-num text-[19px] whitespace-nowrap" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="h-9" />;
  const max = Math.max(...values, 1e-9);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 240},${34 - (v / max) * 30}`).join(" ");
  return (
    <svg viewBox="0 0 240 36" preserveAspectRatio="none" className="block h-9 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

let nextNode = 1;

export interface DesignerProps {
  preset?: string;
  /** Hides the preset picker when embedded in a topic page. */
  embedded?: boolean;
}

export function SystemDesigner({ preset = "full", embedded }: DesignerProps) {
  const [graph, setGraph] = useState<Graph>(() => structuredClone(presetById(preset).graph));
  const [presetId, setPresetId] = useState(preset);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<{ tp: number[]; lat: number[] }>({ tp: [], lat: [] });
  const [message, setMessage] = useState<string | null>(null);
  const [wireTo, setWireTo] = useState<{ from: string; x: number; y: number } | null>(null);
  const [width, setWidth] = useState(1000);

  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Simulation | null>(null);
  const particles = useRef<Particle[]>([]);
  const graphRef = useRef(graph);
  const speedRef = useRef(speed);

  useEffect(() => {
    graphRef.current = graph;
    speedRef.current = speed;
  }, [graph, speed]);

  const pos = useCallback((n: SimNode) => ({
    x: 8 + n.x * (Math.max(width, 720) - NODE_W - 16),
    y: 8 + n.y * (CANVAS_H - NODE_H - 16),
  }), [width]);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Structural changes restart the run, since the system itself changed. */
  const rebuild = useCallback((next: Graph) => {
    setGraph(next);
    graphRef.current = next;
    sim.current = null;
    particles.current = [];
    setSnap(null);
    setHistory({ tp: [], lat: [] });
  }, []);

  /** Setting changes apply live, so the effect on a running system is visible. */
  const patch = useCallback((next: Graph) => {
    setGraph(next);
    graphRef.current = next;
    sim.current?.load(next);
  }, []);

  useEffect(() => {
    if (!running) return;
    const colors = Object.fromEntries(
      (Object.entries(toneColor) as [HopTone, string][]).map(([k, v]) => [
        k,
        getComputedStyle(document.documentElement).getPropertyValue(v).trim(),
      ]),
    ) as Record<HopTone, string>;

    if (!sim.current) sim.current = new Simulation(graphRef.current, 7);
    const s = sim.current;
    let budget = 0;
    s.onHop = ({ from, to, tone }) => {
      // Show errors always. Thin out the rest so busy systems stay readable.
      if (tone !== "error" && budget <= 0) return;
      if (particles.current.length > 260) return;
      budget--;
      const g = graphRef.current;
      const a = g.nodes.find((n) => n.id === from);
      const b = g.nodes.find((n) => n.id === to);
      if (!a || !b) return;
      const pa = pos(a);
      const pb = pos(b);
      particles.current.push({
        ax: pa.x + NODE_W / 2,
        ay: pa.y + NODE_H / 2,
        bx: pb.x + NODE_W / 2,
        by: pb.y + NODE_H / 2,
        t: 0,
        color: colors[tone],
      });
    };

    let frame = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      budget = Math.min(10, budget + dt * 0.12);
      s.advance(dt * speedRef.current);

      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const alive: Particle[] = [];
        for (const p of particles.current) {
          p.t += dt / 520;
          if (p.t >= 1) continue;
          alive.push(p);
          const x = p.ax + (p.bx - p.ax) * p.t;
          const y = p.ay + (p.by - p.ay) * p.t;
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        particles.current = alive;
      }

      if (now - lastUi > 250) {
        lastUi = now;
        const snapshot = s.snapshot();
        setSnap(snapshot);
        setHistory((h) => ({
          tp: [...h.tp.slice(-79), snapshot.throughput],
          lat: [...h.lat.slice(-79), snapshot.p95],
        }));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      s.onHop = undefined;
    };
  }, [running, pos]);

  const addNode = (kind: Kind) => {
    const id = `${kind}-${nextNode++}`;
    const same = graph.nodes.filter((n) => n.kind === kind).length;
    const label = same ? `${PALETTE.find((p) => p.kind === kind)!.label} ${same + 1}` : PALETTE.find((p) => p.kind === kind)!.label;
    const node: SimNode = { id, kind, label, x: 0.42 + (graph.nodes.length % 5) * 0.03, y: 0.08 + (graph.nodes.length % 7) * 0.12, params: {} };
    rebuild({ ...graph, nodes: [...graph.nodes, node] });
    setSelected(id);
    setSelectedEdge(null);
  };

  const removeNode = (id: string) => {
    rebuild({ nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from !== id && e.to !== id) });
    setSelected(null);
  };

  const connect = (from: string, to: string) => {
    if (from === to) return;
    const a = graph.nodes.find((n) => n.id === from)!;
    const b = graph.nodes.find((n) => n.id === to)!;
    if (graph.edges.some((e) => e.from === from && e.to === to)) return;
    if (!canConnect(a.kind, b.kind)) {
      setMessage(`${a.label} cannot call ${b.label}. Requests flow from clients toward data, and only an API talks to Redis, Postgres, BullMQ and RustFS.`);
      return;
    }
    setMessage(null);
    rebuild({ ...graph, edges: [...graph.edges, { from, to }] });
  };

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const box = surface.current!.getBoundingClientRect();
    return { x: e.clientX - box.left + surface.current!.scrollLeft, y: e.clientY - box.top };
  };

  const startDrag = (e: ReactPointerEvent, node: SimNode) => {
    e.preventDefault();
    setSelected(node.id);
    setSelectedEdge(null);
    const start = toLocal(e);
    const origin = pos(node);
    const w = Math.max(width, 720) - NODE_W - 16;
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev);
      const x = Math.max(0, Math.min(1, (origin.x + p.x - start.x - 8) / w));
      const y = Math.max(0, Math.min(1, (origin.y + p.y - start.y - 8) / (CANVAS_H - NODE_H - 16)));
      const next = { ...graphRef.current, nodes: graphRef.current.nodes.map((n) => (n.id === node.id ? { ...n, x, y } : n)) };
      graphRef.current = next;
      setGraph(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      sim.current?.load(graphRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startWire = (e: ReactPointerEvent, node: SimNode) => {
    e.preventDefault();
    e.stopPropagation();
    setWireTo({ from: node.id, ...toLocal(e) });
    const move = (ev: PointerEvent) => setWireTo({ from: node.id, ...toLocal(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWireTo(null);
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-node]");
      const target = under?.getAttribute("data-node");
      if (target) connect(node.id, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const setParam = (id: string, key: keyof NodeParams, value: number | string | boolean) => {
    patch({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n)) });
  };

  const toggleDown = (id: string) => {
    patch({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, down: !n.down } : n)) });
  };

  const spike = () => {
    patch({ ...graph, nodes: graph.nodes.map((n) => (n.kind === "client" ? { ...n, params: { ...n.params, rps: Math.min(3000, (n.params.rps ?? DEFAULTS.client.rps!) * 3) } } : n)) });
  };

  const loadPreset = (id: string) => {
    setPresetId(id);
    setSelected(null);
    setSelectedEdge(null);
    rebuild(structuredClone(presetById(id).graph));
  };

  const issues = useMemo(() => validate(graph), [graph]);
  const insight = useMemo(() => (snap ? diagnose(graph, snap) : null), [graph, snap]);
  const node = graph.nodes.find((n) => n.id === selected) ?? null;
  const statuses = snap ? Object.entries(snap.totals.byStatus).sort(([a], [b]) => a.localeCompare(b)) : [];
  const insightColor = insight?.tone === "bad" ? "var(--loss)" : insight?.tone === "warn" ? "var(--grad)" : "var(--update)";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => setRunning((r) => !r)} disabled={issues.some((i) => i.level === "error")}>
          {running ? "Pause" : snap ? "Resume" : "Run simulation"}
        </button>
        <button type="button" className="btn" onClick={() => rebuild(graph)}>
          Reset run
        </button>
        <button type="button" className="btn" onClick={spike} title="Triples traffic from every client">
          Traffic spike ×3
        </button>
        <div className="segmented" role="group" aria-label="Simulation speed">
          {[1, 2, 5].map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        {!embedded && (
          <label className="ml-auto flex items-center gap-2 text-[13px] text-[var(--muted)]">
            Start from
            <select className="control" value={presetId} onChange={(e) => loadPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-[150px_minmax(0,1fr)_260px]">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-2">
          <div className="px-1.5 pb-1.5 text-[12px] text-[var(--muted)]">Click to add</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-1">
            {PALETTE.map((p) => (
              <button
                key={p.kind}
                type="button"
                onClick={() => addNode(p.kind)}
                title={p.note}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] text-[var(--text-soft)] hover:bg-[var(--raised)] hover:text-[var(--text)]"
              >
                <Icon kind={p.icon} size={17} />
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--stage)]">
          <div ref={surface} className="overflow-x-auto" onPointerDown={(e) => {
            if (e.target === e.currentTarget.firstChild) {
              setSelected(null);
              setSelectedEdge(null);
            }
          }}>
            <div className="relative" style={{ width: Math.max(width, 720), height: CANVAS_H }}>
              <svg className="absolute inset-0" width="100%" height="100%" aria-hidden>
                <defs>
                  <marker id="sim-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0 8 4 0 8z" fill="var(--line-strong)" />
                  </marker>
                </defs>
                {graph.edges.map((e, i) => {
                  const a = graph.nodes.find((n) => n.id === e.from);
                  const b = graph.nodes.find((n) => n.id === e.to);
                  if (!a || !b) return null;
                  const pa = pos(a);
                  const pb = pos(b);
                  const x1 = pa.x + NODE_W / 2;
                  const y1 = pa.y + NODE_H / 2;
                  const x2 = pb.x + NODE_W / 2;
                  const y2 = pb.y + NODE_H / 2;
                  const on = selectedEdge === i;
                  return (
                    <g key={`${e.from}-${e.to}`} className="cursor-pointer" onClick={() => { setSelectedEdge(i); setSelected(null); }}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? "var(--signal)" : "var(--line-strong)"} strokeWidth={on ? 2 : 1.3} />
                    </g>
                  );
                })}
                {wireTo && (() => {
                  const a = graph.nodes.find((n) => n.id === wireTo.from)!;
                  const pa = pos(a);
                  return <line x1={pa.x + NODE_W} y1={pa.y + NODE_H / 2} x2={wireTo.x} y2={wireTo.y} stroke="var(--signal)" strokeWidth={1.6} strokeDasharray="4 4" />;
                })()}
              </svg>
              <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
              {graph.nodes.map((n) => {
                const p = pos(n);
                const st = snap?.nodes[n.id];
                const load = st?.utilization ?? 0;
                const hot = load > 0.85;
                return (
                  <div
                    key={n.id}
                    data-node={n.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.label}${n.down ? ", down" : ""}`}
                    aria-pressed={selected === n.id}
                    onPointerDown={(e) => startDrag(e, n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(n.id);
                        setSelectedEdge(null);
                      }
                    }}
                    className="absolute flex cursor-grab touch-none flex-col justify-center rounded-xl border bg-[var(--neuron)] px-2 select-none"
                    style={{
                      left: p.x,
                      top: p.y,
                      width: NODE_W,
                      height: NODE_H,
                      borderColor: n.down ? "var(--loss)" : selected === n.id ? "var(--signal)" : hot ? "var(--grad)" : "var(--line-strong)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-[var(--text)]" style={{ color: n.down ? "var(--loss)" : undefined }}>
                      <Icon kind={iconOf(n.kind)} size={15} />
                      <span className="truncate text-[11.5px] font-medium">{n.label}</span>
                    </div>
                    <div className="stage-num mt-0.5 truncate text-[10px] text-[var(--muted)]">
                      {n.down
                        ? "down"
                        : n.kind === "client"
                          ? `${n.params.rps ?? DEFAULTS.client.rps} req/s`
                          : n.kind === "queue"
                            ? `${st?.waiting ?? 0} wait · ${st?.delayed ?? 0} retry`
                            : n.kind === "redis" || n.kind === "cdn"
                              ? `${st?.keys ?? 0} keys`
                              : `${Math.round(load * 100)}% busy`}
                    </div>
                    {n.kind !== "client" && n.kind !== "dns" && (
                      <div className="mt-1 h-[3px] overflow-hidden rounded bg-[var(--line)]">
                        <div className="h-full" style={{ width: `${load * 100}%`, background: hot ? "var(--loss)" : "var(--update)" }} />
                      </div>
                    )}
                    {!["dns", "redis", "db", "worker", "storage"].includes(n.kind) && (
                      <span
                        role="button"
                        aria-label={`Draw a connection from ${n.label}`}
                        title="Drag onto another component to connect"
                        onPointerDown={(e) => startWire(e, n)}
                        className="absolute top-1/2 -right-[7px] h-[13px] w-[13px] -translate-y-1/2 cursor-crosshair touch-none rounded-full border-2 border-[var(--stage)] bg-[var(--signal)]"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3">
          {node ? (
            <Inspector
              node={node}
              graph={graph}
              onParam={(k, v) => setParam(node.id, k, v)}
              onLabel={(label) => patch({ ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, label } : n)) })}
              onDown={() => toggleDown(node.id)}
              onRemove={() => removeNode(node.id)}
              onConnect={(to) => connect(node.id, to)}
              stats={snap?.nodes[node.id]}
            />
          ) : selectedEdge !== null && graph.edges[selectedEdge] ? (
            <div className="text-[13.5px]">
              <div className="mb-2 font-medium text-[var(--text)]">Connection</div>
              <p className="mb-3 text-[var(--text-soft)]">
                {graph.nodes.find((n) => n.id === graph.edges[selectedEdge]!.from)?.label} calls{" "}
                {graph.nodes.find((n) => n.id === graph.edges[selectedEdge]!.to)?.label}.
              </p>
              <button type="button" className="btn btn-small" onClick={() => {
                rebuild({ ...graph, edges: graph.edges.filter((_, i) => i !== selectedEdge) });
                setSelectedEdge(null);
              }}>
                Remove connection
              </button>
            </div>
          ) : (
            <div className="space-y-2 text-[13.5px] leading-relaxed text-[var(--text-soft)]">
              <div className="font-medium text-[var(--text)]">How to use this</div>
              <p>Drag a component to move it. Drag its blue dot onto another to connect them.</p>
              <p>Click a component to change its settings or take it down, even while the simulation runs.</p>
            </div>
          )}
        </div>
      </div>

      {message && (
        <p className="rounded-lg border border-[var(--line-strong)] px-3 py-2 text-[13.5px] text-[var(--text-soft)]" role="status">
          {message}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-1 text-[13.5px]">
          {issues.map((i) => (
            <li key={i.text} style={{ color: i.level === "error" ? "var(--loss)" : "var(--grad)" }}>
              {i.text}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <p className="mb-3 min-h-[22px] text-[15px]" style={{ color: insight ? insightColor : "var(--muted)" }} aria-live="polite">
          {insight?.text ?? "Press Run simulation to send traffic through this design."}
        </p>
        <div className="flex flex-wrap gap-y-3">
          <Metric label="Successful req/s" value={snap ? snap.throughput.toFixed(0) : "–"} />
          <Metric label="Median latency" value={snap ? `${snap.p50.toFixed(0)} ms` : "–"} />
          <Metric label="p95 latency" value={snap ? `${snap.p95.toFixed(0)} ms` : "–"} />
          <Metric label="Errors" value={snap ? `${(snap.errorRate * 100).toFixed(1)}%` : "–"} tone={snap && snap.errorRate > 0.01 ? "var(--loss)" : undefined} />
          <Metric label="Cache hits" value={snap?.cacheHitRate != null ? `${(snap.cacheHitRate * 100).toFixed(0)}%` : "–"} />
          <Metric label="Jobs waiting" value={snap ? `${snap.queueDepth}` : "–"} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[11.5px] text-[var(--muted)]">Throughput</div>
            <Spark values={history.tp} color="var(--update)" />
          </div>
          <div>
            <div className="text-[11.5px] text-[var(--muted)]">p95 latency</div>
            <Spark values={history.lat} color="var(--grad)" />
          </div>
        </div>
        {statuses.length > 0 && (
          <div className="stage-num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
            {statuses.map(([code, count]) => (
              <span key={code} style={{ color: code === "200" ? undefined : "var(--loss)" }}>
                {code}: {count}
              </span>
            ))}
            {snap && Object.keys(snap.clients).length > 1 && Object.entries(snap.clients).map(([id, c]) => (
              <span key={id}>
                {graph.nodes.find((n) => n.id === id)?.label}: {c.ok.toFixed(0)} ok/s
              </span>
            ))}
            {snap && snap.totals.jobsAdded > 0 && (
              <span>
                jobs done {snap.totals.jobsCompleted}, failed {snap.totals.jobsFailed}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Inspector({
  node,
  graph,
  onParam,
  onLabel,
  onDown,
  onRemove,
  onConnect,
  stats,
}: {
  node: SimNode;
  graph: Graph;
  onParam: (k: keyof NodeParams, v: number | string | boolean) => void;
  onLabel: (label: string) => void;
  onDown: () => void;
  onRemove: () => void;
  onConnect: (to: string) => void;
  stats?: Snapshot["nodes"][string];
}) {
  const d = DEFAULTS[node.kind];
  const fields = FIELDS[node.kind] ?? [];
  const targets = graph.nodes.filter(
    (n) => n.id !== node.id && canConnect(node.kind, n.kind) && !graph.edges.some((e) => e.from === node.id && e.to === n.id),
  );
  const storage =
    node.kind === "storage"
      ? storageAvailable(node.params.drives ?? d.drives!, node.params.parity ?? d.parity!, node.params.failedDrives ?? d.failedDrives!)
      : null;

  return (
    <div className="flex flex-col gap-2.5 text-[13px]">
      <input aria-label="Component name" className="control w-full font-medium" value={node.label} onChange={(e) => onLabel(e.target.value)} />

      {node.kind === "limiter" && (
        <>
          <label className="flex flex-col gap-1 text-[var(--text-soft)]">
            Algorithm
            <select className="control" value={node.params.algorithm ?? d.algorithm} onChange={(e) => onParam("algorithm", e.target.value)}>
              <option value="token">Token bucket</option>
              <option value="fixed">Fixed window</option>
              <option value="sliding">Sliding log</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[var(--text-soft)]">
            <input type="checkbox" checked={node.params.perClient ?? false} onChange={(e) => onParam("perClient", e.target.checked)} />
            Separate limit per client
          </label>
        </>
      )}

      {fields.map((f) => {
        const value = (node.params[f.key] ?? d[f.key] ?? 0) as number;
        return (
          <label key={f.key} className="flex flex-col gap-0.5 text-[var(--text-soft)]">
            <span className="flex justify-between gap-2">
              {f.label}
              <span className="stage-num text-[var(--text)]">{f.format ? f.format(value) : value}</span>
            </span>
            <input type="range" min={f.min} max={f.max} step={f.step} value={value} className="w-full accent-[var(--signal)]" onChange={(e) => onParam(f.key, Number(e.target.value))} />
          </label>
        );
      })}

      {storage && (
        <p className="stage-num text-[12px] text-[var(--text-soft)]">
          {storage.data} data shards. Reads {storage.read ? "ok" : "FAIL"}, writes {storage.write ? "ok" : "FAIL"}.
        </p>
      )}
      {stats && node.kind !== "client" && (
        <p className="stage-num text-[12px] text-[var(--muted)]">
          handled {stats.handled}, errors {stats.errors}
          {stats.hits !== undefined || stats.misses !== undefined ? `, hits ${stats.hits ?? 0}, misses ${stats.misses ?? 0}` : ""}
        </p>
      )}

      {targets.length > 0 && !["dns", "redis", "db", "worker", "storage"].includes(node.kind) && (
        <label className="flex flex-col gap-1 text-[var(--text-soft)]">
          Connect to
          <select className="control" value="" onChange={(e) => e.target.value && onConnect(e.target.value)}>
            <option value="">Choose…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {node.kind !== "client" && (
          <button type="button" className="btn btn-small" onClick={onDown}>
            {node.down ? "Bring back up" : "Take down"}
          </button>
        )}
        <button type="button" className="btn btn-small" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
