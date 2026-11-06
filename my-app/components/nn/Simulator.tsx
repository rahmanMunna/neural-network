"use client";

import { useMemo, useState } from "react";
import { applyGradients, parameterCount, randomParams, run } from "@/lib/nn/engine";
import type { HiddenActivation, LossName, NetSpec, Params, Sample } from "@/lib/nn/engine";
import { buildTimeline, num } from "@/lib/nn/timeline";
import type { Detail } from "@/lib/nn/timeline";
import { Player } from "./Player";

type Task = "binary" | "multiclass" | "regression";

interface Config {
  inputs: number;
  hidden: number[];
  task: Task;
  classes: number;
  activation: HiddenActivation;
  loss: LossName;
  learningRate: number;
  x: number[];
  /** Class index, or the numeric target for regression. */
  y: number;
  seed: number;
}

const LIMITS = { inputs: 6, layers: 4, neurons: 8, classes: 5 };

const LOSSES: Record<Task, { value: LossName; label: string }[]> = {
  binary: [
    { value: "bce", label: "Binary cross-entropy" },
    { value: "mse", label: "Mean squared error" },
  ],
  multiclass: [
    { value: "cce", label: "Categorical cross-entropy" },
    { value: "mse", label: "Mean squared error" },
  ],
  regression: [{ value: "mse", label: "Mean squared error" }],
};

const ACTIVATIONS: { value: HiddenActivation; label: string }[] = [
  { value: "sigmoid", label: "Sigmoid" },
  { value: "tanh", label: "Tanh" },
  { value: "relu", label: "ReLU" },
  { value: "leakyRelu", label: "Leaky ReLU" },
];

const INITIAL: Config = {
  inputs: 3,
  hidden: [4],
  task: "binary",
  classes: 3,
  activation: "sigmoid",
  loss: "bce",
  learningRate: 0.1,
  x: [1, 0.5, 1.5],
  y: 1,
  seed: 7,
};

function specOf(c: Config): NetSpec {
  const outputs = c.task === "multiclass" ? c.classes : 1;
  return {
    sizes: [c.inputs, ...c.hidden, outputs],
    hiddenActivation: c.activation,
    outputActivation: c.task === "multiclass" ? "softmax" : c.task === "binary" ? "sigmoid" : "linear",
    loss: c.loss,
    learningRate: c.learningRate,
  };
}

function sampleOf(c: Config): Sample {
  const x = c.x.slice(0, c.inputs);
  if (c.task === "multiclass") {
    return { x, target: Array.from({ length: c.classes }, (_, k) => (k === c.y ? 1 : 0)) };
  }
  return { x, target: [c.y] };
}

/* ---------- small controls ---------- */

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" disabled={value <= min} aria-label={`Fewer: ${label}`} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="stage-num">{value}</span>
      <button type="button" disabled={value >= max} aria-label={`More: ${label}`} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11.5px] text-[var(--muted)]">{label}</span>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select aria-label={label} className="control" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumberInput({ value, onChange, label, step = 0.1 }: { value: number; onChange: (v: number) => void; label: string; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label={label}
      type="number"
      step={step}
      className="control stage-num w-[68px]"
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v)) onChange(v);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/* ---------- loss history ---------- */

function LossHistory({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span>Iteration 1</span>;
  }
  const w = 96;
  const h = 20;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <span className="flex items-center gap-2">
      <span>Iteration {values.length}</span>
      <svg width={w} height={h} role="img" aria-label={`Loss over ${values.length} iterations`}>
        <polyline points={pts} fill="none" stroke="var(--loss)" strokeWidth={1.5} />
      </svg>
      <span className="stage-num text-[var(--loss)]">{num(values[values.length - 1], 3)}</span>
    </span>
  );
}

/* ---------- simulator ---------- */

interface Training {
  params: Params;
  history: number[];
  /** Bumped to remount the player on a fresh timeline. */
  epoch: number;
  auto: boolean;
}

export function Simulator() {
  const [config, setConfig] = useState(INITIAL);
  const [detailChoice, setDetailChoice] = useState<Detail | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);

  const spec = useMemo(() => specOf(config), [config]);
  const sample = useMemo(() => sampleOf(config), [config]);

  const fresh = (c: Config, epoch: number): Training => {
    const s = specOf(c);
    const params = randomParams(s.sizes, c.seed);
    return { params, history: [run(s, params, sampleOf(c)).loss], epoch, auto: false };
  };
  const [training, setTraining] = useState<Training>(() => fresh(INITIAL, 0));

  const totalNeurons = spec.sizes.reduce((a, b) => a + b, 0);
  const totalEdges = spec.sizes.reduce((s, n, l) => (l === 0 ? 0 : s + n * spec.sizes[l - 1]), 0);
  const detail: Detail = detailChoice ?? (totalNeurons <= 14 && totalEdges <= 40 ? "neuron" : "layer");

  const timeline = useMemo(
    () => buildTimeline({ spec, params: training.params, sample, detail, digits: 4 }),
    [spec, training.params, sample, detail],
  );

  /** Any change to the setup restarts training, except changing data or rate. */
  const apply = (patch: Partial<Config>, keepWeights = false) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (keepWeights) {
      const s = specOf(next);
      setTraining((t) => ({
        ...t,
        history: [run(s, t.params, sampleOf(next)).loss],
        epoch: t.epoch + 1,
        auto: false,
      }));
    } else {
      setTraining((t) => fresh(next, t.epoch + 1));
    }
  };

  const setTask = (task: Task) => {
    apply({
      task,
      loss: LOSSES[task][0].value,
      y: task === "regression" ? 0.7 : task === "binary" ? 1 : 0,
    });
  };

  const setInputs = (n: number) => {
    const x = Array.from({ length: n }, (_, i) => config.x[i] ?? 0.5);
    apply({ inputs: n, x });
  };

  const setHidden = (hidden: number[]) => apply({ hidden });

  const nextIteration = () => {
    setTraining((t) => {
      const params = timeline.nextParams;
      return { params, history: [...t.history, timeline.nextTrace.loss], epoch: t.epoch + 1, auto: false };
    });
  };

  const trainMany = (n: number) => {
    setTraining((t) => {
      let params = t.params;
      const history = t.history.slice();
      for (let i = 0; i < n; i++) {
        params = applyGradients(spec, params, run(spec, params, sample));
        history.push(run(spec, params, sample).loss);
      }
      return { params, history, epoch: t.epoch + 1, auto: false };
    });
  };

  const count = parameterCount(spec.sizes);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className="btn btn-small" aria-expanded={setupOpen} onClick={() => setSetupOpen((v) => !v)}>
          {setupOpen ? "Hide setup" : "Show setup"}
        </button>
        <span className="text-[13px] text-[var(--muted)]">
          {spec.sizes.join(" – ")} network, {count.total} parameters. Use the steppers under the stage to reshape it.
        </span>
      </div>

      <div
        hidden={!setupOpen}
        className="grid gap-x-5 gap-y-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_1fr_auto_auto]"
      >
        <Field label="Task">
          <div className="segmented" role="group" aria-label="Task">
            {(
              [
                ["binary", "Binary"],
                ["multiclass", "Multi-class"],
                ["regression", "Regression"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={config.task === v} onClick={() => setTask(v)}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Classes">
          {config.task === "multiclass" ? (
            <Stepper
              label="classes"
              value={config.classes}
              min={3}
              max={LIMITS.classes}
              onChange={(v) => apply({ classes: v, y: Math.min(config.y, v - 1) })}
            />
          ) : (
            <span className="flex h-[34px] items-center text-[13px] text-[var(--muted)]">
              {config.task === "binary" ? "2" : "n/a"}
            </span>
          )}
        </Field>
        <Field label="Hidden activation">
          <Select label="Hidden activation" value={config.activation} options={ACTIVATIONS} onChange={(activation) => apply({ activation })} />
        </Field>
        <Field label="Loss function">
          <Select label="Loss function" value={config.loss} options={LOSSES[config.task]} onChange={(loss) => apply({ loss }, true)} />
        </Field>
        <Field label={`Learning rate: ${config.learningRate}`} className="min-w-36">
          <input
            aria-label="Learning rate"
            type="range"
            min={0.01}
            max={2}
            step={0.01}
            value={config.learningRate}
            className="h-[34px] w-full accent-[var(--signal)]"
            onChange={(e) => apply({ learningRate: Number(e.target.value) }, true)}
          />
        </Field>
        <Field label="Detail">
          <div className="segmented" role="group" aria-label="Detail">
            {(
              [
                ["neuron", "Each neuron"],
                ["layer", "Each layer"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                aria-pressed={detail === v}
                onClick={() => {
                  setDetailChoice(v);
                  setTraining((t) => ({ ...t, epoch: t.epoch + 1 }));
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Training example" className="sm:col-span-2 lg:col-span-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-[var(--muted)]">x =</span>
            {config.x.slice(0, config.inputs).map((v, i) => (
              <NumberInput
                key={i}
                label={`Input ${i + 1}`}
                value={v}
                onChange={(val) => {
                  const x = config.x.slice();
                  x[i] = val;
                  apply({ x }, true);
                }}
              />
            ))}
            <span className="ml-3 text-[13px] text-[var(--muted)]">{config.task === "regression" ? "target =" : "true class ="}</span>
            {config.task === "regression" ? (
              <NumberInput label="Target value" value={config.y} onChange={(y) => apply({ y }, true)} />
            ) : (
              <div className="segmented" role="group" aria-label="True class">
                {Array.from({ length: config.task === "binary" ? 2 : config.classes }, (_, k) => (
                  <button key={k} type="button" aria-pressed={config.y === k} onClick={() => apply({ y: k }, true)}>
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Weights" className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn btn-small" onClick={() => apply({ seed: config.seed + 1 })}>
              Randomize
            </button>
            <button type="button" className="btn btn-small" onClick={() => setTraining((t) => fresh(config, t.epoch + 1))}>
              Reset
            </button>
            <button type="button" className="btn btn-small" onClick={() => trainMany(10)}>
              Train 10
            </button>
            <button type="button" className="btn btn-small" onClick={() => trainMany(100)}>
              Train 100
            </button>
          </div>
        </Field>
      </div>

      <Player
        key={`${training.epoch}-${detail}`}
        steps={timeline.steps}
        spec={spec}
        target={sample.target}
        uid={`sim${training.epoch}`}
        aboveHeight={setupOpen ? 196 : 44}
        label={`Animated neural network with layers ${spec.sizes.join(", ")}`}
        finish={{ label: "Next iteration", onClick: nextIteration }}
        autoPlay={training.auto}
        bottomPad={56}
        statusRight={
          <LossHistory values={training.history} />
        }
        overlay={(layout, scale) => (
          <>
            {layout.columns.map((x, l) => {
              const L = layout.columns.length - 1;
              const isInput = l === 0;
              const isOutput = l === L;
              if (isOutput) return null;
              const left = x * scale;
              const value = isInput ? config.inputs : config.hidden[l - 1];
              return (
                <div key={l} className="absolute bottom-2 flex -translate-x-1/2 items-center gap-1" style={{ left }}>
                  <Stepper
                    label={isInput ? "input neurons" : `neurons in hidden layer ${l}`}
                    value={value}
                    min={1}
                    max={isInput ? LIMITS.inputs : LIMITS.neurons}
                    onChange={(v) => {
                      if (isInput) setInputs(v);
                      else setHidden(config.hidden.map((n, idx) => (idx === l - 1 ? v : n)));
                    }}
                  />
                  {!isInput && (
                    <button
                      type="button"
                      className="icon-chip"
                      aria-label={`Remove hidden layer ${l}`}
                      title="Remove this layer"
                      onClick={() => setHidden(config.hidden.filter((_, idx) => idx !== l - 1))}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {config.hidden.length < LIMITS.layers && (
              <button
                type="button"
                className="btn btn-small absolute bottom-2 -translate-x-1/2"
                style={{
                  left: ((layout.columns[layout.columns.length - 2] + layout.columns[layout.columns.length - 1]) / 2) * scale,
                }}
                onClick={() => setHidden([...config.hidden, 3])}
              >
                + Layer
              </button>
            )}
          </>
        )}
      />
    </div>
  );
}
