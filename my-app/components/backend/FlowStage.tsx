"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useProgress, useSettled } from "@/components/nn/usePlayer";
import type { Clock } from "@/components/nn/usePlayer";
import { TONE_COLOR } from "@/lib/backend/flow";
import type { CompiledCard, CompiledScenario, FlowNode, FlowStep, NodeState, TimedHop } from "@/lib/backend/flow";
import { iconPath } from "./icons";

const ramp = (p: number, a: number, b: number) => (b <= a ? (p >= a ? 1 : 0) : Math.max(0, Math.min(1, (p - a) / (b - a))));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const TILE_W = 132;
const TILE_H = 58;

interface Point {
  x: number;
  y: number;
}

interface Layout {
  width: number;
  height: number;
  at: Record<string, Point>;
}

function place(nodes: FlowNode[], width: number, height: number): Layout {
  const padX = TILE_W / 2 + 22;
  const top = TILE_H / 2 + 18;
  const bottom = TILE_H / 2 + 46;
  const at: Layout["at"] = {};
  for (const n of nodes) {
    at[n.id] = {
      x: padX + n.x * (width - padX * 2),
      y: top + n.y * (height - top - bottom),
    };
  }
  return { width, height, at };
}

interface Curve {
  p0: Point;
  c0: Point;
  c1: Point;
  p1: Point;
}

/**
 * Wire between two tiles. Traffic in each direction keeps to its own side, so a
 * request and its response never overlap.
 */
function wire(a: Point, b: Point, lane: number): Curve {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    const s = Math.sign(dx) || 1;
    const p0 = { x: a.x + (s * TILE_W) / 2, y: a.y + lane };
    const p1 = { x: b.x - (s * TILE_W) / 2, y: b.y + lane };
    const pull = Math.abs(p1.x - p0.x) * 0.45;
    return { p0, c0: { x: p0.x + s * pull, y: p0.y }, c1: { x: p1.x - s * pull, y: p1.y }, p1 };
  }
  const s = Math.sign(dy) || 1;
  const p0 = { x: a.x + lane, y: a.y + (s * TILE_H) / 2 };
  const p1 = { x: b.x + lane, y: b.y - (s * TILE_H) / 2 };
  const pull = Math.abs(p1.y - p0.y) * 0.45;
  return { p0, c0: { x: p0.x, y: p0.y + s * pull }, c1: { x: p1.x, y: p1.y - s * pull }, p1 };
}

const pathOf = (c: Curve) =>
  `M${c.p0.x.toFixed(1)} ${c.p0.y.toFixed(1)}C${c.c0.x.toFixed(1)} ${c.c0.y.toFixed(1)} ${c.c1.x.toFixed(1)} ${c.c1.y.toFixed(1)} ${c.p1.x.toFixed(1)} ${c.p1.y.toFixed(1)}`;

function pointOn(c: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * c.p0.x + 3 * u * u * t * c.c0.x + 3 * u * t * t * c.c1.x + t ** 3 * c.p1.x,
    y: u ** 3 * c.p0.y + 3 * u * u * t * c.c0.y + 3 * u * t * t * c.c1.y + t ** 3 * c.p1.y,
  };
}

/** Lane by direction, stable for each pair of nodes. */
const laneOf = (from: string, to: string) => (from < to ? -5 : 5);

/* ---------- resting network ---------- */

const Network = memo(function Network({
  nodes,
  edges,
  layout,
  state,
  focus,
}: {
  nodes: FlowNode[];
  edges: [string, string][];
  layout: Layout;
  state: NodeState;
  focus: Set<string> | null;
}) {
  return (
    <g>
      {edges.map(([a, b]) => {
        const c = wire(layout.at[a]!, layout.at[b]!, 0);
        const on = !focus || (focus.has(a) && focus.has(b));
        return (
          <path key={`${a}-${b}`} d={pathOf(c)} fill="none" stroke="var(--line-strong)" strokeWidth={1.2} strokeDasharray="3 4" className="dimmable" opacity={on ? 0.9 : 0.25} />
        );
      })}
      {nodes.map((n) => {
        const p = layout.at[n.id]!;
        const down = state.down.includes(n.id);
        const dim = focus ? !focus.has(n.id) : false;
        const lines = state.lines[n.id] ?? [];
        return (
          <g key={n.id} className="dimmable" opacity={dim ? 0.32 : 1} transform={`translate(${(p.x - TILE_W / 2).toFixed(1)} ${(p.y - TILE_H / 2).toFixed(1)})`}>
            <rect width={TILE_W} height={TILE_H} rx={12} fill="var(--neuron)" stroke={down ? "var(--loss)" : "var(--line-strong)"} strokeWidth={down ? 1.8 : 1.2} />
            <g transform="translate(11 19)" fill="none" stroke={down ? "var(--loss)" : "var(--text-soft)"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d={iconPath(n.kind)} />
            </g>
            <text x={39} y={n.sub ? 25 : 34} fontSize={12.5} fontWeight={600} fill="var(--text)">
              {n.label}
            </text>
            {n.sub && (
              <text x={39} y={42} fontSize={10.5} fill="var(--muted)">
                {n.sub}
              </text>
            )}
            {down && (
              <text x={TILE_W - 8} y={14} textAnchor="end" fontSize={10} fontWeight={600} fill="var(--loss)">
                DOWN
              </text>
            )}
            {lines.slice(0, 3).map((line, i) => (
              <text key={i} x={TILE_W / 2} y={TILE_H + 15 + i * 14} textAnchor="middle" fontSize={10.5} className="stage-num" fill="var(--neg)">
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
});

/* ---------- moving parts ---------- */

function HopTrail({ hop, layout, p }: { hop: TimedHop; layout: Layout; p: number }) {
  const c = wire(layout.at[hop.from]!, layout.at[hop.to]!, laneOf(hop.from, hop.to));
  const t = ease(ramp(p, hop.window[0], hop.window[1]));
  if (t <= 0) return null;
  const color = TONE_COLOR[hop.tone];
  const fade = 1 - ramp(p, hop.window[1], hop.window[1] + 0.2) * 0.65;
  return <path d={pathOf(c)} fill="none" pathLength={1} strokeDasharray={`${t} 1`} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={fade} />;
}

function HopPacket({ hop, layout, p }: { hop: TimedHop; layout: Layout; p: number }) {
  const [w0, w1] = hop.window;
  if (p < w0 || p >= w1) return null;
  const c = wire(layout.at[hop.from]!, layout.at[hop.to]!, laneOf(hop.from, hop.to));
  const pos = pointOn(c, ease(ramp(p, w0, w1)));
  const color = TONE_COLOR[hop.tone];
  const w = hop.label.length * 6.6 + 16;
  return (
    <g pointerEvents="none">
      <circle cx={pos.x} cy={pos.y} r={11} fill={color} fillOpacity={0.18} />
      <circle cx={pos.x} cy={pos.y} r={4.6} fill={color} />
      <g transform={`translate(${pos.x.toFixed(1)} ${(pos.y - 21).toFixed(1)})`}>
        <rect x={-w / 2} y={-10.5} width={w} height={21} rx={6} fill="var(--pill)" stroke={color} strokeOpacity={0.9} />
        <text textAnchor="middle" y={3.9} fontSize={11} className="stage-num" fill={color}>
          {hop.label}
        </text>
      </g>
    </g>
  );
}

function CardView({ card, layout, p }: { card: CompiledCard; layout: Layout; p: number }) {
  const first = card.rows[0]?.at ?? 0.5;
  const open = ease(ramp(p, first - 0.1, first - 0.01));
  if (open <= 0) return null;
  const home = layout.at[card.at]!;
  const longest = Math.max(card.title.length + (card.tag?.length ?? 0) + 4, ...card.rows.map((r) => r.t.length));
  const w = Math.min(layout.width - 24, Math.max(230, longest * 7.25 + 30));
  const h = 46 + card.rows.length * 22;
  const prefersRight = home.x + TILE_W / 2 + 14 + w <= layout.width - 8;
  const fitsLeft = home.x - TILE_W / 2 - 14 - w >= 8;
  const x = prefersRight
    ? home.x + TILE_W / 2 + 14
    : fitsLeft
      ? home.x - TILE_W / 2 - 14 - w
      : Math.max(8, Math.min(layout.width - w - 8, home.x - w / 2));
  const y = Math.max(8, Math.min(layout.height - h - 8, home.y - h / 2));
  const color = TONE_COLOR[card.tone];
  return (
    <g pointerEvents="none">
      <rect
        x={lerp(home.x - TILE_W / 2, x, open)}
        y={lerp(home.y - TILE_H / 2, y, open)}
        width={lerp(TILE_W, w, open)}
        height={lerp(TILE_H, h, open)}
        rx={13}
        fill="var(--card)"
        stroke={color}
        strokeOpacity={0.75}
        strokeWidth={1.4}
      />
      <g opacity={ramp(open, 0.6, 1)}>
        <text x={x + 14} y={y + 24} fontSize={13.5} fontWeight={600} fill="var(--text)">
          {card.title}
        </text>
        {card.tag && (
          <text x={x + w - 14} y={y + 24} textAnchor="end" fontSize={11} fill={color}>
            {card.tag}
          </text>
        )}
        {card.rows.map((row, i) => {
          const q = ramp(p, row.at - 0.02, row.at + 0.02);
          if (q <= 0) return null;
          const fill = row.tone === "plain" ? "var(--text)" : row.tone === "muted" ? "var(--muted)" : TONE_COLOR[row.tone];
          return (
            <text key={i} x={x + 14 - (1 - q) * 6} y={y + 50 + i * 22} fontSize={12} fontWeight={row.strong ? 600 : 400} className="stage-num" fill={fill} opacity={q} style={{ whiteSpace: "pre" }}>
              {row.t}
            </text>
          );
        })}
      </g>
    </g>
  );
}

function Frame({ step, layout, p }: { step: FlowStep; layout: Layout; p: number }) {
  return (
    <g>
      {step.hops.map((h, i) => (
        <HopTrail key={i} hop={h} layout={layout} p={p} />
      ))}
      {step.card && <CardView card={step.card} layout={layout} p={p} />}
      {step.hops.map((h, i) => (
        <HopPacket key={i} hop={h} layout={layout} p={p} />
      ))}
    </g>
  );
}

function Live({ clock, step, layout }: { clock: Clock; step: FlowStep; layout: Layout }) {
  const p = useProgress(clock);
  return <Frame step={step} layout={layout} p={p} />;
}

/* ---------- stage ---------- */

const MIN_WIDTH = 880;

export function FlowStage({
  nodes,
  scenario,
  step,
  clock,
  label,
}: {
  nodes: FlowNode[];
  scenario: CompiledScenario;
  step: FlowStep;
  clock: Clock;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 480 });
  const settled = useSettled(clock);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry!.contentRect.width, h: entry!.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.max(1, Math.min(1.3, size.w / 1180));
  const pixelW = Math.max(size.w, MIN_WIDTH);
  const logicalW = pixelW / scale;
  const logicalH = size.h / scale;
  const layout = useMemo(() => place(nodes, logicalW, logicalH), [nodes, logicalW, logicalH]);
  const focus = useMemo(() => (step.focus ? new Set(step.focus) : null), [step.focus]);

  // Narrow screens scroll sideways, so keep the active node in view.
  useEffect(() => {
    const el = host.current;
    const target = step.card?.at ?? step.hops[0]?.to;
    if (!el || !target || el.scrollWidth <= el.clientWidth) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: layout.at[target]!.x * scale - el.clientWidth / 2, behavior: reduced ? "auto" : "smooth" });
  }, [step, layout, scale]);

  return (
    <div ref={host} className="absolute inset-0 overflow-x-auto overflow-y-hidden">
      <svg role="img" aria-label={`${label}. ${step.title}`} viewBox={`0 0 ${logicalW} ${logicalH}`} width={pixelW} height={size.h} className="block select-none">
        <Network nodes={nodes} edges={scenario.edges} layout={layout} state={settled ? step.after : step.before} focus={focus} />
        <Live clock={clock} step={step} layout={layout} />
      </svg>
    </div>
  );
}
