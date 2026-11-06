"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { NetSpec } from "@/lib/nn/engine";
import { activate } from "@/lib/nn/engine";
import { computeLayout, curveBetween, curvePath, curvePoint, edgeCurve, layoutCard, portPoint } from "@/lib/nn/layout";
import type { CardLayout, StageLayout } from "@/lib/nn/layout";
import { eid, neuronName, nid, num, ACTIVATION_SYMBOL, LOSS_LABEL } from "@/lib/nn/timeline";
import type { Card, Chain, EdgeMorph, Plot, Pulse, Row, Scene, Snapshot, Step, Tone } from "@/lib/nn/timeline";
import { useProgress, useSettled } from "./usePlayer";
import type { Clock } from "./usePlayer";

const TONE: Record<Tone, string> = {
  plain: "var(--text)",
  muted: "var(--muted)",
  signal: "var(--signal)",
  grad: "var(--grad)",
  update: "var(--update)",
  loss: "var(--loss)",
};

const ramp = (p: number, a: number, b: number) => (b <= a ? (p >= a ? 1 : 0) : Math.max(0, Math.min(1, (p - a) / (b - a))));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Fill level of a neuron. Unbounded activations are squashed so it still reads. */
function fillLevel(v: number) {
  if (v >= 0 && v <= 1) return v;
  const m = Math.abs(v);
  return m / (1 + m);
}

const edgeWidth = (w: number) => 0.7 + 2.6 * Math.min(1, Math.abs(w) / 0.6);

/* ---------- small marks ---------- */

function Pill({ x, y, text, tone, opacity = 1, strong }: { x: number; y: number; text: string; tone: Tone; opacity?: number; strong?: boolean }) {
  const w = text.length * 6.5 + 12;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={opacity} pointerEvents="none">
      <rect x={-w / 2} y={-10} width={w} height={20} rx={6} fill="var(--pill)" stroke={TONE[tone]} strokeOpacity={strong ? 0.9 : 0.45} />
      <text textAnchor="middle" y={3.8} fontSize={11} className="stage-num" fill={TONE[tone]}>
        {text}
      </text>
    </g>
  );
}

function NeuronBody({
  x,
  y,
  r,
  level,
  negative,
  value,
  tone = "signal",
  id,
  glow = 0,
}: {
  x: number;
  y: number;
  r: number;
  level: number | null;
  negative?: boolean;
  value: string | null;
  tone?: Tone;
  id: string;
  glow?: number;
}) {
  const fillH = level === null ? 0 : level * r * 2;
  const color = negative ? "var(--neg)" : TONE[tone];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      {glow > 0 && <circle r={r + 7 * glow} fill="none" stroke={color} strokeOpacity={0.5 * glow} strokeWidth={1.5} />}
      <clipPath id={id}>
        <circle r={r - 1} />
      </clipPath>
      <circle r={r} fill="var(--neuron)" />
      {fillH > 0 && <rect x={-r} y={r - fillH} width={r * 2} height={fillH} fill={color} fillOpacity={0.3} clipPath={`url(#${id})`} />}
            <circle r={r} fill="none" stroke={value === null ? "var(--line-strong)" : color} strokeOpacity={value === null ? 1 : 0.85} strokeWidth={1.4} />
      {value !== null && r >= 19 && (
        <text textAnchor="middle" y={4.4} fontSize={r >= 25 ? 12.5 : 10.5} className="stage-num" fill="var(--text)">
          {value}
        </text>
      )}
    </g>
  );
}

/* ---------- the resting network ---------- */

interface NetworkProps {
  layout: StageLayout;
  spec: NetSpec;
  snap: Snapshot;
  focus: Scene["focus"];
  inputNames?: string[];
  target: number[];
  uid: string;
}

const NetworkLayer = memo(function NetworkLayer({ layout, spec, snap, focus, inputNames, target, uid }: NetworkProps) {
  const L = spec.sizes.length - 1;
  const { r } = layout;

  const maxGrad = useMemo(() => {
    let m = 1e-12;
    snap.gradW.forEach((layer) => layer.forEach((row) => row.forEach((g) => (m = Math.max(m, Math.abs(g ?? 0))))));
    return m;
  }, [snap.gradW]);

  // Under the neuron when there is room, otherwise beside it.
  const rowGap = Math.min(
    ...layout.neurons.map((col) => (col.length > 1 ? col[1].y - col[0].y : Infinity)),
  );
  const pillBelow = rowGap >= r * 2 + 26;
  const neuronSet = focus ? new Set(focus.neurons) : null;
  const edgeSet = focus ? new Set(focus.edges) : null;

  const headers = spec.sizes.map((_, l) => {
    if (l === 0) return ["Input", ""];
    if (l === L) return ["Output", ACTIVATION_SYMBOL[spec.outputActivation]];
    return [L === 2 ? "Hidden" : `Hidden ${l}`, ACTIVATION_SYMBOL[spec.hiddenActivation]];
  });

  return (
    <g>
      {/* output to loss wires */}
      {layout.neurons[L].map((n) => {
        const c = curveBetween({ x: n.x + r, y: n.y }, { x: layout.loss.x - layout.loss.w / 2, y: layout.loss.y });
        return (
          <path
            key={n.j}
            d={curvePath(c)}
            fill="none"
            stroke="var(--line-strong)"
            strokeDasharray="3 5"
            className="dimmable"
            opacity={focus && !focus.loss ? 0.2 : 0.8}
          />
        );
      })}

      {spec.sizes.map((_, l) =>
        l === 0
          ? null
          : snap.w[l].map((row, j) =>
              row.map((w, i) => {
                const g = snap.gradW[l][j][i];
                const id = eid(l, j, i);
                const dim = edgeSet ? !edgeSet.has(id) : false;
                const c = edgeCurve(layout, l, j, i);
                let stroke = w >= 0 ? "var(--pos)" : "var(--neg)";
                let width = edgeWidth(w);
                let opacity = 0.5;
                if (g !== null) {
                  const m = Math.abs(g) / maxGrad;
                  stroke = "var(--grad)";
                  width = 0.8 + 2.8 * m;
                  opacity = 0.25 + 0.7 * m;
                } else if (snap.updated[l][j]) {
                  stroke = "var(--update)";
                  opacity = 0.7;
                }
                return (
                  <g key={id} data-tip={`e:${id}`} className="dimmable" opacity={dim ? 0.07 : 1}>
                    <path d={curvePath(c)} fill="none" stroke={stroke} strokeWidth={width} strokeOpacity={opacity} strokeLinecap="round" />
                    <path d={curvePath(c)} fill="none" stroke="transparent" strokeWidth={10} />
                  </g>
                );
              }),
            ),
      )}

      {/* column headings */}
      {headers.map(([title, fn], l) => (
        <g key={l}>
          <text x={layout.columns[l]} y={22} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)">
            {title}
          </text>
          {fn && (
            <text x={layout.columns[l]} y={38} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {fn}
            </text>
          )}
        </g>
      ))}
      <text x={layout.loss.x} y={22} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)">
        Loss
      </text>
      <text x={layout.loss.x} y={38} textAnchor="middle" fontSize={11} fill="var(--muted)">
        {LOSS_LABEL[spec.loss]}
      </text>

      {/* input labels */}
      {layout.neurons[0].map((n) => (
        <text
          key={n.j}
          x={n.x - r - 10}
          y={n.y + 4}
          textAnchor="end"
          fontSize={12}
          fill="var(--muted)"
          className="dimmable"
          opacity={neuronSet && !neuronSet.has(nid(0, n.j)) ? 0.25 : 1}
        >
          {inputNames?.[n.j] ?? neuronName(spec, 0, n.j)}
        </text>
      ))}

      {spec.sizes.map((_, l) =>
        layout.neurons[l].map((n) => {
          const a = snap.a[l][n.j];
          const z = snap.z[l][n.j];
          const shown = a ?? z;
          const d = snap.delta[l][n.j];
          const dim = neuronSet ? !neuronSet.has(nid(l, n.j)) : false;
          return (
            <g key={n.j} data-tip={`n:${nid(l, n.j)}`} className="dimmable" opacity={dim ? 0.22 : 1}>
              <NeuronBody
                id={`${uid}-n${l}-${n.j}`}
                x={n.x}
                y={n.y}
                r={r}
                level={a === null ? null : fillLevel(a)}
                negative={a !== null && a < 0}
                value={shown === null ? null : num(shown, shown === a && l === 0 ? 2 : 3)}
              />
              {shown === null && r >= 19 && (
                <text x={n.x} y={n.y + 4.4} textAnchor="middle" fontSize={11.5} fill="var(--muted)">
                  {neuronName(spec, l, n.j)}
                </text>
              )}
              {d !== null && (
                <Pill
                  x={pillBelow ? n.x : n.x + r + 38}
                  y={pillBelow ? n.y + r + 13 : n.y}
                  text={`δ ${num(d, 3)}`}
                  tone="grad"
                />
              )}
            </g>
          );
        }),
      )}

      {/* target tags */}
      {layout.neurons[L].map((n) => (
        <text
          key={n.j}
          x={n.x + r + 12}
          y={n.y + 18}
          fontSize={11}
          className="stage-num dimmable"
          fill="var(--muted)"
          opacity={focus && !focus.loss ? 0.3 : 1}
        >
          y = {num(target[n.j], Number.isInteger(target[n.j]) ? 0 : 2)}
        </text>
      ))}

      {/* loss node */}
      <g className="dimmable" opacity={focus && !focus.loss ? 0.3 : 1} data-tip="loss">
        <rect
          x={layout.loss.x - layout.loss.w / 2}
          y={layout.loss.y - layout.loss.h / 2}
          width={layout.loss.w}
          height={layout.loss.h}
          rx={12}
          fill="var(--neuron)"
          stroke={snap.loss === null ? "var(--line-strong)" : "var(--loss)"}
          strokeWidth={1.4}
        />
        <text
          x={layout.loss.x}
          y={layout.loss.y + 7}
          textAnchor="middle"
          fontSize={20}
          className="stage-num"
          fill={snap.loss === null ? "var(--muted)" : "var(--loss)"}
        >
          {snap.loss === null ? "L" : num(snap.loss, 3)}
        </text>
      </g>
    </g>
  );
});

/* ---------- plots ---------- */

function PlotView({ plot, box, p }: { plot: Plot; box: NonNullable<CardLayout["plot"]>; p: number }) {
  const q = ramp(p, plot.window[0], plot.window[1]);
  const pad = { l: 8, r: 8, t: 10, b: 26 };
  const W = box.w - pad.l - pad.r;
  const H = box.h - pad.t - pad.b;
  const X = (v: number, min: number, max: number) => box.x + pad.l + ((v - min) / (max - min)) * W;
  const Y = (v: number, min: number, max: number) => box.y + pad.t + (1 - (v - min) / (max - min)) * H;

  if (plot.kind === "bars") {
    const n = plot.values.length;
    const gap = 8;
    const bw = (W - gap * (n - 1)) / n;
    return (
      <g opacity={ramp(p, plot.window[0] - 0.1, plot.window[0])}>
        {plot.values.map((v, k) => {
          const h = v * H * ease(q);
          const x = box.x + pad.l + k * (bw + gap);
          return (
            <g key={k}>
              <rect x={x} y={box.y + pad.t} width={bw} height={H} rx={3} fill="var(--pill)" stroke={plot.target[k] ? "var(--update)" : "none"} />
              <rect x={x} y={box.y + pad.t + H - h} width={bw} height={h} rx={3} fill="var(--signal)" fillOpacity={0.75} />
              <text x={x + bw / 2} y={box.y + box.h - 10} textAnchor="middle" fontSize={10} className="stage-num" fill="var(--muted)">
                {num(v, 2)}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  if (plot.kind === "lossCurve") {
    const maxL = 4;
    const f = (v: number) => (plot.y === 1 ? -Math.log(Math.max(v, 1e-6)) : -Math.log(Math.max(1 - v, 1e-6)));
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const v = i / 60;
      pts.push(`${X(v, 0, 1).toFixed(1)},${Y(Math.min(maxL, f(v)), 0, maxL).toFixed(1)}`);
    }
    const dotX = X(plot.yhat, 0, 1);
    const dotY = Y(Math.min(maxL, f(plot.yhat)), 0, maxL);
    const base = Y(0, 0, maxL);
    return (
      <g opacity={ramp(p, plot.window[0] - 0.08, plot.window[0])}>
        <line x1={box.x + pad.l} x2={box.x + pad.l + W} y1={base} y2={base} stroke="var(--line-strong)" />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--loss)" strokeOpacity={0.8} strokeWidth={1.6} />
        <line x1={dotX} x2={dotX} y1={base} y2={lerp(base, dotY, ease(q))} stroke="var(--signal)" strokeDasharray="3 3" />
        <circle cx={dotX} cy={lerp(base, dotY, ease(q))} r={4.5} fill="var(--signal)" />
        <text x={box.x + pad.l} y={box.y + box.h - 8} fontSize={10.5} fill="var(--muted)" className="stage-num">
          ŷ from 0 to 1
        </text>
        <text x={box.x + box.w - pad.r} y={box.y + box.h - 8} fontSize={10.5} textAnchor="end" fill="var(--muted)" className="stage-num">
          −log({plot.y === 1 ? "ŷ" : "1−ŷ"})
        </text>
      </g>
    );
  }

  // Activation curve: follow z up to the curve, then across to the output.
  const zMax = Math.max(4, Math.ceil(Math.abs(plot.z)) + 1);
  const fn = plot.fn;
  const sample = (v: number) => activate(fn, v);
  const yMin = fn === "sigmoid" ? -0.05 : fn === "tanh" ? -1.1 : Math.min(-0.5, sample(-zMax));
  const yMax = fn === "sigmoid" ? 1.05 : fn === "tanh" ? 1.1 : Math.max(1, sample(zMax));
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const v = -zMax + (2 * zMax * i) / 60;
    pts.push(`${X(v, -zMax, zMax).toFixed(1)},${Y(sample(v), yMin, yMax).toFixed(1)}`);
  }
  const axisY = Y(Math.max(0, yMin), yMin, yMax);
  const axisX = X(0, -zMax, zMax);
  const zX = X(plot.z, -zMax, zMax);
  const aY = Y(plot.value, yMin, yMax);
  const up = ease(ramp(q, 0, 0.5));
  const across = ease(ramp(q, 0.5, 1));
  const dotY = lerp(axisY, aY, up);
  const dotX = lerp(zX, axisX, across);

  return (
    <g opacity={ramp(p, plot.window[0] - 0.08, plot.window[0])}>
      <line x1={box.x + pad.l} x2={box.x + pad.l + W} y1={axisY} y2={axisY} stroke="var(--line-strong)" />
      <line x1={axisX} x2={axisX} y1={box.y + pad.t} y2={box.y + pad.t + H} stroke="var(--line-strong)" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--signal)" strokeOpacity={0.75} strokeWidth={1.6} />
      <line x1={zX} x2={zX} y1={axisY} y2={dotY} stroke="var(--signal)" strokeDasharray="3 3" />
      {across > 0 && <line x1={zX} x2={dotX} y1={aY} y2={aY} stroke="var(--signal)" strokeDasharray="3 3" />}
      <circle cx={up < 1 ? zX : dotX} cy={dotY} r={4.5} fill="var(--signal)" />
      <text x={box.x + box.w / 2} y={box.y + box.h - 7} textAnchor="middle" fontSize={12.5} className="stage-num" fill="var(--text)" opacity={ramp(q, 0.75, 1)}>
        {ACTIVATION_SYMBOL[fn]}({num(plot.z, 2)}) = {num(plot.value, 3)}
      </text>
    </g>
  );
}

/* ---------- card: a neuron opened up ---------- */

function CardRow({ row, geo, font, p }: { row: Row; geo: CardLayout["rows"][string]; font: number; p: number }) {
  const q = ramp(p, row.at - 0.025, row.at + 0.02);
  if (q <= 0) return null;
  const strong = row.kind === "result" || row.kind === "total";
  const shift = (1 - ease(q)) * (geo.column === "left" ? -8 : 8);
  const baseline = geo.y + font * 0.36;
  const text = (
    <text
      x={geo.x + shift}
      y={baseline}
      fontSize={font}
      fontWeight={strong ? 600 : 400}
      className="stage-num"
      opacity={q}
      style={{ whiteSpace: "pre" }}
    >
      {row.spans.map((s, i) => (
        <tspan key={i} fill={TONE[s.tone ?? "plain"]}>
          {s.t}
        </tspan>
      ))}
    </text>
  );
  if (!row.trail) return text;
  return (
    <>
      {text}
      <text
        x={geo.x + (row.trailCh ?? 0) * font * 0.6 + shift}
        y={baseline}
        textAnchor="end"
        fontSize={font}
        fontWeight={strong ? 600 : 400}
        className="stage-num"
        opacity={q}
        style={{ whiteSpace: "pre" }}
      >
        {row.trail.map((s, i) => (
          <tspan key={i} fill={TONE[s.tone ?? "plain"]}>
            {s.t}
          </tspan>
        ))}
      </text>
    </>
  );
}

function CardView({ card, geo, p }: { card: Card; geo: CardLayout; p: number }) {
  const m = ease(ramp(p, 0, 0.09));
  const f = geo.from;
  const content = ramp(p, 0.06, 0.12);
  const tone = TONE[card.tone];
  return (
    <g>
      <rect
        x={lerp(f.x, geo.x, m)}
        y={lerp(f.y, geo.y, m)}
        width={lerp(f.w, geo.w, m)}
        height={lerp(f.h, geo.h, m)}
        rx={lerp(f.rx, 14, m)}
        fill="var(--card)"
        stroke={tone}
        strokeOpacity={0.7}
        strokeWidth={1.4}
      />
      <g opacity={content}>
        <text x={geo.x + 14} y={geo.y + 25} fontSize={16} fontWeight={600} fill="var(--text)" className="stage-num">
          {card.title}
        </text>
        <text x={geo.x + geo.w - 14} y={geo.y + 24} textAnchor="end" fontSize={11.5} fill={tone}>
          {card.tag}
        </text>
        {geo.headings.map((h) => (
          <text key={h.text} x={h.x} y={h.y} fontSize={10.5} fill="var(--muted)" letterSpacing={0.2}>
            {h.text}
          </text>
        ))}
        {geo.divider !== undefined && (
          <line x1={geo.divider} x2={geo.divider} y1={geo.y + 40} y2={geo.y + geo.h - 12} stroke="var(--line)" />
        )}
        {[...(card.left?.rows ?? []), ...(card.right?.rows ?? [])].map((row) => (
          <CardRow key={row.id} row={row} geo={geo.rows[row.id]} font={geo.font} p={p} />
        ))}
        {card.plot && geo.plot && <PlotView plot={card.plot} box={geo.plot} p={p} />}
      </g>
    </g>
  );
}

/* ---------- things that travel ---------- */

function resolveCurve(pulse: Pulse, layout: StageLayout, card: CardLayout | null) {
  const centre = (port: Pulse["from"]): number => {
    if (port.kind === "neuron") return layout.neurons[port.l][port.j].x;
    if (port.kind === "row") return card?.rows[port.id]?.port.x ?? 0;
    if (port.kind === "loss") return layout.loss.x;
    return 0;
  };
  const goingRight = centre(pulse.to) >= centre(pulse.from);
  const a = portPoint(pulse.from, layout, card, goingRight ? "out" : "in");
  const b = portPoint(pulse.to, layout, card, goingRight ? "in" : "out");
  return curveBetween(a, b);
}

function LinesOf({ pulse, layout, card, p }: { pulse: Pulse; layout: StageLayout; card: CardLayout | null; p: number }) {
  const c = resolveCurve(pulse, layout, card);
  const [w0, w1] = pulse.window;
  const t = ease(ramp(p, w0, w1)) * (pulse.stop ?? 1);
  const tone = TONE[pulse.tone];
  const d = curvePath(c);
  const fade = pulse.persist || pulse.stop ? 1 : 1 - ramp(p, w1, w1 + 0.08);
  const started = ramp(p, w0 - 0.05, w0);
  return (
    <g pointerEvents="none">
      {card && pulse.persist && <path d={d} fill="none" stroke={tone} strokeOpacity={0.2 * started} strokeWidth={1.2} />}
      {t > 0 && fade > 0 && (
        <path d={d} fill="none" pathLength={1} strokeDasharray={`${t} 1`} stroke={tone} strokeOpacity={0.9 * fade} strokeWidth={2} strokeLinecap="round" />
      )}
    </g>
  );
}

const behindCard = (pt: { x: number; y: number }, card: CardLayout | null) =>
  card !== null && pt.x > card.x && pt.x < card.x + card.w && pt.y > card.y && pt.y < card.y + card.h;

function PulseMarks({ pulse, layout, card, p }: { pulse: Pulse; layout: StageLayout; card: CardLayout | null; p: number }) {
  const c = resolveCurve(pulse, layout, card);
  const [w0, w1] = pulse.window;
  const raw = ramp(p, w0, w1);
  const t = ease(raw) * (pulse.stop ?? 1);
  const pos = curvePoint(c, t);
  // In a crowded network the source neuron can sit under the card. Its marks
  // must never land on top of the calculation.
  const live = p >= w0 && p < w1 && !behindCard(pos, card);
  const chipPos = curvePoint(c, 0.3);
  const label = t < 0.5 * (pulse.stop ?? 1) ? pulse.startLabel ?? pulse.endLabel : pulse.endLabel ?? pulse.startLabel;
  const stayed = pulse.stop !== undefined && p >= w1;
  return (
    <g pointerEvents="none">
      {pulse.chip && p >= w0 - 0.04 && !behindCard(chipPos, card) && (
        <Pill x={chipPos.x} y={chipPos.y} text={pulse.chip} tone="muted" opacity={ramp(p, w0 - 0.04, w0)} />
      )}
      {live && (
        <>
          <circle cx={pos.x} cy={pos.y} r={12} fill={TONE[pulse.tone]} fillOpacity={0.18} />
          <circle cx={pos.x} cy={pos.y} r={4.6} fill={TONE[pulse.tone]} />
        </>
      )}
      {live && label && <Pill x={pos.x} y={pos.y - 20} text={label} tone={pulse.tone} strong />}
      {stayed && pulse.endLabel && <Pill x={pos.x} y={pos.y} text={pulse.endLabel} tone={pulse.tone} strong />}
    </g>
  );
}

function MorphEdge({ morph, layout, card, maxDelta, p }: { morph: EdgeMorph; layout: StageLayout; card: CardLayout | null; maxDelta: number; p: number }) {
  const port = card?.rows[`u${morph.i}`]?.port;
  const c = port
    ? curveBetween(portPoint({ kind: "neuron", l: morph.l - 1, j: morph.i }, layout, card, "out"), port)
    : edgeCurve(layout, morph.l, morph.j, morph.i);
  const q = ramp(p, morph.window[0], morph.window[1]);
  const change = Math.abs(morph.to - morph.from) / maxDelta;
  // The real change is tiny, so the flash is scaled to the largest move in view.
  const swell = Math.sin(Math.PI * Math.min(q, 1)) * 5 * change;
  const width = lerp(edgeWidth(morph.from), edgeWidth(morph.to), q) + swell;
  return (
    <path
      d={curvePath(c)}
      fill="none"
      stroke="var(--update)"
      strokeOpacity={0.35 + 0.6 * q}
      strokeWidth={width}
      strokeLinecap="round"
      pointerEvents="none"
    />
  );
}

function ChainView({ chain, layout, spec, bottomPad, p }: { chain: Chain; layout: StageLayout; spec: NetSpec; bottomPad: number; p: number }) {
  const L = spec.sizes.length - 1;
  const { r } = layout;
  const parts: ReactNode[] = [];
  chain.links.forEach((link, idx) => {
    const q = ramp(p, link.window[0], link.window[1]);
    const shown = ramp(p, link.window[0], link.window[0] + 0.03);
    if (link.kind === "neuron" && link.neuron) {
      const n = layout.neurons[link.neuron[0]][link.neuron[1]];
      parts.push(
        <g key={idx} pointerEvents="none">
          <circle cx={n.x} cy={n.y} r={r + 5} fill="none" stroke="var(--grad)" strokeWidth={2} pathLength={1} strokeDasharray={`${ease(q)} 1`} transform={`rotate(-90 ${n.x} ${n.y})`} />
          <Pill x={n.x} y={n.y - r - 18} text={link.label} tone="grad" opacity={shown} strong />
        </g>,
      );
      return;
    }
    const curve =
      link.kind === "loss"
        ? curveBetween(
            { x: layout.loss.x - layout.loss.w / 2, y: layout.loss.y },
            { x: layout.neurons[L][link.neuron![1]].x + r, y: layout.neurons[L][link.neuron![1]].y },
          )
        : (() => {
            const c = edgeCurve(layout, ...link.edge!);
            return { p0: c.p1, c0: c.c1, c1: c.c0, p1: c.p0 };
          })();
    const t = ease(q);
    const pos = curvePoint(curve, t);
    const mid = curvePoint(curve, 0.5);
    parts.push(
      <g key={idx} pointerEvents="none">
        <path d={curvePath(curve)} fill="none" pathLength={1} strokeDasharray={`${t} 1`} stroke="var(--grad)" strokeWidth={2.6} strokeLinecap="round" />
        {q > 0 && q < 1 && <circle cx={pos.x} cy={pos.y} r={5} fill="var(--grad)" />}
        <Pill x={mid.x} y={mid.y - 16} text={link.label} tone="grad" opacity={shown} strong />
      </g>,
    );
  });

  // Sits above whatever occupies the bottom of the stage.
  const y = layout.height - Math.max(bottomPad, 26) + 8;
  const finished = ramp(p, 0.88, 0.94);
  const stripW = chain.links.length * 62 + 110;
  return (
    <g>
      {parts}
      <rect
        x={layout.width / 2 - stripW / 2}
        y={y - 16}
        width={stripW}
        height={23}
        rx={7}
        fill="var(--pill)"
        opacity={ramp(p, 0.04, 0.1) * 0.92}
        pointerEvents="none"
      />
      <text x={layout.width / 2} y={y} textAnchor="middle" fontSize={13} className="stage-num" style={{ whiteSpace: "pre" }}>
        {chain.links.map((link, idx) => (
          <tspan key={idx} fill="var(--grad)" opacity={ramp(p, link.window[1] - 0.02, link.window[1] + 0.01)}>
            {idx > 0 ? " × " : ""}
            {num(link.value, 3)}
          </tspan>
        ))}
        <tspan fill="var(--text)" fontWeight={600} opacity={finished}>
          {"  =  "}
          {num(chain.product, 4)}
        </tspan>
      </text>
    </g>
  );
}

/* ---------- one rendered frame ---------- */

function SceneFrame({
  step,
  layout,
  spec,
  uid,
  bottomPad,
  p,
}: {
  step: Step;
  layout: StageLayout;
  spec: NetSpec;
  uid: string;
  bottomPad: number;
  p: number;
}) {
  const { scene, after, before } = step;
  const cardGeo = useMemo(() => (scene.card ? layoutCard(scene.card, layout) : null), [scene.card, layout]);
  const maxDelta = useMemo(
    () => scene.edgeMorphs.reduce((m, e) => Math.max(m, Math.abs(e.to - e.from)), 1e-12),
    [scene.edgeMorphs],
  );
  return (
    <g>
      {scene.edgeMorphs.map((e) => (
        <MorphEdge key={eid(e.l, e.j, e.i)} morph={e} layout={layout} card={cardGeo} maxDelta={maxDelta} p={p} />
      ))}
      {scene.pulses.map((pulse) => (
        <LinesOf key={pulse.id} pulse={pulse} layout={layout} card={cardGeo} p={p} />
      ))}
      {scene.neuronFx.map((fx) => {
        const q = ease(ramp(p, fx.window[0], fx.window[1]));
        if (q <= 0) return null;
        const n = layout.neurons[fx.l][fx.j];
        const from = before.a[fx.l][fx.j];
        const to = after.a[fx.l][fx.j] ?? 0;
        const value = lerp(from ?? 0, to, q);
        return (
          <NeuronBody
            key={nid(fx.l, fx.j)}
            id={`${uid}-fx${fx.l}-${fx.j}`}
            x={n.x}
            y={n.y}
            r={layout.r}
            level={fillLevel(value)}
            negative={value < 0}
            value={num(value, fx.l === 0 ? 2 : 3)}
            glow={Math.sin(Math.PI * q)}
          />
        );
      })}
      {scene.lossFx && (
        <rect
          x={layout.loss.x - layout.loss.w / 2 - 6}
          y={layout.loss.y - layout.loss.h / 2 - 6}
          width={layout.loss.w + 12}
          height={layout.loss.h + 12}
          rx={16}
          fill="none"
          stroke="var(--loss)"
          strokeOpacity={Math.sin(Math.PI * ramp(p, scene.lossFx[0], scene.lossFx[1])) * 0.8}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      {scene.card && cardGeo && <CardView card={scene.card} geo={cardGeo} p={p} />}
      {scene.pulses.map((pulse) => (
        <PulseMarks key={pulse.id} pulse={pulse} layout={layout} card={cardGeo} p={p} />
      ))}
      {scene.chain && <ChainView chain={scene.chain} layout={layout} spec={spec} bottomPad={bottomPad} p={p} />}
    </g>
  );
}

function LiveScene({ clock, ...rest }: { clock: Clock; step: Step; layout: StageLayout; spec: NetSpec; uid: string; bottomPad: number }) {
  const p = useProgress(clock);
  return <SceneFrame {...rest} p={p} />;
}

/* ---------- hover readout ---------- */

function describe(tip: string, snap: Snapshot, spec: NetSpec, lr: number): { title: string; lines: [string, string, Tone?][] } | null {
  const parts = tip.split(":");
  if (parts[0] === "loss") {
    return { title: "Loss", lines: [["L", snap.loss === null ? "not computed yet" : num(snap.loss, 5), "loss"]] };
  }
  if (parts[0] === "n") {
    const l = +parts[1];
    const j = +parts[2];
    const lines: [string, string, Tone?][] = [];
    const z = snap.z[l][j];
    const a = snap.a[l][j];
    const d = snap.delta[l][j];
    if (l > 0) lines.push(["bias", num(snap.b[l][j], 4)]);
    if (z !== null) lines.push(["z", num(z, 4), "signal"]);
    if (a !== null) lines.push([l === 0 ? "value" : "output", num(a, 4), "signal"]);
    if (d !== null) lines.push(["δ", num(d, 4), "grad"]);
    return { title: neuronName(spec, l, j), lines };
  }
  const l = +parts[1];
  const j = +parts[2];
  const i = +parts[3];
  const w = snap.w[l][j][i];
  const g = snap.gradW[l][j][i];
  const lines: [string, string, Tone?][] = [["weight", num(w, 4)]];
  if (g !== null) {
    lines.push(["∂L/∂w", num(g, 4), "grad"]);
    lines.push(["next value", num(w - lr * g, 4), "update"]);
  }
  return { title: `${neuronName(spec, l - 1, i)} → ${neuronName(spec, l, j)}`, lines };
}

/* ---------- stage ---------- */

export interface StageProps {
  spec: NetSpec;
  step: Step;
  clock: Clock;
  target: number[];
  inputNames?: string[];
  uid: string;
  bottomPad?: number;
  /** Extra controls positioned over the stage, such as neuron steppers. */
  overlay?: (layout: StageLayout, scale: number) => ReactNode;
  label: string;
}

const MIN_WIDTH = 880;

export function Stage({ spec, step, clock, target, inputNames, uid, bottomPad = 26, overlay, label }: StageProps) {
  const settled = useSettled(clock);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 520 });
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One stage unit is one CSS pixel up to a point, then the drawing grows with
  // the screen. Narrow screens scroll sideways instead of shrinking the math.
  const scale = Math.max(1, Math.min(1.35, size.w / 1180));
  const pixelW = Math.max(size.w, MIN_WIDTH);
  const logicalW = pixelW / scale;
  const logicalH = size.h / scale;
  const layout = useMemo(
    () => computeLayout(spec.sizes, logicalW, logicalH, bottomPad),
    [spec.sizes, logicalW, logicalH, bottomPad],
  );

  // On a narrow screen the stage scrolls sideways, so bring the open card into view.
  const card = step.scene.card;
  useEffect(() => {
    const el = host.current;
    if (!el || !card || el.scrollWidth <= el.clientWidth) return;
    const geo = layoutCard(card, layout);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: geo.x * scale - 16, behavior: reduced ? "auto" : "smooth" });
  }, [card, layout, scale]);

  const [shown, setShown] = useState(step);
  const [ghost, setGhost] = useState<Step | null>(null);
  if (shown !== step) {
    setShown(step);
    setGhost(shown.scene.card || shown.scene.chain ? shown : null);
  }

  const info = tip ? describe(tip.id, step.after, spec, spec.learningRate) : null;

  return (
    <div ref={host} className="absolute inset-0 overflow-x-auto overflow-y-hidden">
      <div className="relative h-full" style={{ width: pixelW }}>
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${logicalW} ${logicalH}`}
          width={pixelW}
          height={size.h}
          className="block select-none"
          onPointerMove={(e) => {
            const el = (e.target as Element).closest("[data-tip]");
            const id = el?.getAttribute("data-tip");
            if (!id) {
              if (tip) setTip(null);
              return;
            }
            const box = e.currentTarget.getBoundingClientRect();
            setTip({ id, x: e.clientX - box.left, y: e.clientY - box.top });
          }}
          onPointerLeave={() => setTip(null)}
        >
          <NetworkLayer
            layout={layout}
            spec={spec}
            snap={settled ? step.after : step.before}
            focus={step.scene.focus}
            inputNames={inputNames}
            target={target}
            uid={uid}
          />
          {ghost && (
            <g key={ghost.id} className="scene-exit" pointerEvents="none">
              <SceneFrame step={ghost} layout={layout} spec={spec} uid={`${uid}-g`} bottomPad={bottomPad} p={1} />
            </g>
          )}
          <LiveScene clock={clock} step={step} layout={layout} spec={spec} uid={uid} bottomPad={bottomPad} />
        </svg>
        {overlay?.(layout, scale)}
        {info && tip && (
          <div
            className="pointer-events-none absolute z-20 min-w-36 rounded-lg border border-[var(--line-strong)] bg-[var(--card)] px-3 py-2 shadow-xl"
            style={{ left: Math.min(tip.x + 14, pixelW - 180), top: Math.max(tip.y - 16, 4) }}
          >
            <div className="stage-num mb-1 text-[13px] font-semibold text-[var(--text)]">{info.title}</div>
            {info.lines.map(([k, v, tone]) => (
              <div key={k} className="stage-num flex justify-between gap-5 text-[12px]">
                <span className="text-[var(--muted)]">{k}</span>
                <span style={{ color: TONE[tone ?? "plain"] }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
