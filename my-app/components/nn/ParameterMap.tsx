"use client";

import { useState } from "react";
import { exampleInputNames, exampleParams, exampleSpec } from "@/lib/nn/example";
import { computeLayout, curvePath, edgeCurve } from "@/lib/nn/layout";
import { neuronName, num } from "@/lib/nn/timeline";

type Pick = { kind: "w"; l: number; j: number; i: number } | { kind: "b"; l: number; j: number } | null;

const WIDTH = 760;
const HEIGHT = 300;

export function ParameterMap() {
  const [pick, setPick] = useState<Pick>(null);
  const spec = exampleSpec;
  const { w, b } = exampleParams;

  // The stage layout reserves room for the loss, which this diagram leaves out.
  const layout = computeLayout(spec.sizes, WIDTH + 270, HEIGHT, 12);

  const clear = () => setPick(null);
  const isPicked = (l: number, j: number, i: number) => pick?.kind === "w" && pick.l === l && pick.j === j && pick.i === i;

  const cell = (value: number, target: Pick, key: string) => (
    <button
      key={key}
      type="button"
      className="stage-num cursor-default rounded-md px-1.5 py-1 text-right text-[13.5px] transition-colors hover:bg-[var(--raised)] focus:bg-[var(--raised)]"
      style={{ color: value < 0 ? "var(--neg)" : "var(--text)" }}
      onMouseEnter={() => setPick(target)}
      onFocus={() => setPick(target)}
      onMouseLeave={clear}
      onBlur={clear}
    >
      {num(value, 2)}
    </button>
  );

  return (
    <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--stage)]">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full min-w-[560px]" role="img" aria-label="The 3-4-1 network with its weights">
          {spec.sizes.map((_, l) =>
            l === 0
              ? null
              : w[l].map((row, j) =>
                  row.map((v, i) => {
                    const on = isPicked(l, j, i);
                    return (
                      <path
                        key={`${l}${j}${i}`}
                        d={curvePath(edgeCurve(layout, l, j, i))}
                        fill="none"
                        stroke={on ? "var(--signal)" : v >= 0 ? "var(--pos)" : "var(--neg)"}
                        strokeWidth={on ? 3.2 : 0.7 + 2.6 * Math.min(1, Math.abs(v) / 0.6)}
                        strokeOpacity={pick ? (on ? 1 : 0.15) : 0.55}
                        className="dimmable"
                      />
                    );
                  }),
                ),
          )}
          {layout.neurons.map((col, l) =>
            col.map((n) => {
              const on = pick?.l === l && pick?.j === n.j;
              return (
                <g key={`${l}${n.j}`}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={layout.r}
                    fill="var(--neuron)"
                    stroke={on ? "var(--update)" : "var(--line-strong)"}
                    strokeWidth={on ? 2.4 : 1.4}
                  />
                  <text x={n.x} y={n.y + 4.5} textAnchor="middle" fontSize={13} fill="var(--text)" className="stage-num">
                    {on && pick?.kind === "b" ? num(b[l][n.j], 2) : neuronName(spec, l, n.j)}
                  </text>
                  {l === 0 && (
                    <text x={n.x - layout.r - 10} y={n.y + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
                      {exampleInputNames[n.j].split(" ").pop()}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
      </div>

      <div className="grid gap-6 border-t border-[var(--line)] p-4 sm:grid-cols-[auto_auto_auto_auto] sm:justify-between">
        <div>
          <div className="mb-1 text-[12.5px] text-[var(--muted)]">Input to hidden, 12 weights</div>
          <div className="grid grid-cols-3 gap-x-1" style={{ gridTemplateColumns: "repeat(3, auto)" }}>
            {w[1].flatMap((row, j) => row.map((v, i) => cell(v, { kind: "w", l: 1, j, i }, `${j}${i}`)))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] text-[var(--muted)]">Hidden biases, 4</div>
          <div className="grid">{b[1].map((v, j) => cell(v, { kind: "b", l: 1, j }, `b${j}`))}</div>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] text-[var(--muted)]">Hidden to output, 4 weights</div>
          <div className="grid">{w[2][0].map((v, i) => cell(v, { kind: "w", l: 2, j: 0, i }, `o${i}`))}</div>
        </div>
        <div>
          <div className="mb-1 text-[12.5px] text-[var(--muted)]">Output bias, 1</div>
          <div className="grid">{cell(b[2][0], { kind: "b", l: 2, j: 0 }, "bo")}</div>
        </div>
      </div>
    </div>
  );
}
