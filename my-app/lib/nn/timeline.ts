/**
 * Compiles one training iteration into an ordered list of steps.
 *
 * A step is plain data: what the learner reads, which values exist once it is
 * done, and a scene saying what travels where and when. Scene times are
 * fractions of the step (0 to 1), so any frame can be rendered from
 * (step, progress) alone. That is what makes Next, Prev, jumping and autoplay
 * all the same operation.
 */

import { applyGradients, run } from "./engine.ts";
import type { NetSpec, Params, Sample, Trace } from "./engine.ts";

export type Phase = "setup" | "forward" | "loss" | "backward" | "update" | "verify";

export const PHASE_LABEL: Record<Phase, string> = {
  setup: "Setup",
  forward: "Forward pass",
  loss: "Loss",
  backward: "Backpropagation",
  update: "Gradient descent",
  verify: "Check",
};

export type Tone = "plain" | "muted" | "signal" | "grad" | "update" | "loss";

export interface Span {
  t: string;
  tone?: Tone;
}

export interface Row {
  id: string;
  spans: Span[];
  /** Progress at which the row appears. */
  at: number;
  kind?: "term" | "total" | "result";
  /** Right-aligned ending, so labels of any width still line up with figures. */
  trail?: Span[];
  /** Column, in characters, that the trail ends at. */
  trailCh?: number;
}

export interface Column {
  heading: string;
  rows: Row[];
  width: number;
}

export type Plot =
  | {
      kind: "activation";
      fn: "sigmoid" | "tanh" | "relu" | "leakyRelu" | "linear";
      z: number;
      value: number;
      window: [number, number];
    }
  | { kind: "lossCurve"; y: number; yhat: number; window: [number, number] }
  | { kind: "bars"; values: number[]; target: number[]; window: [number, number] };

export interface Card {
  anchor: { kind: "neuron"; l: number; j: number } | { kind: "loss" };
  title: string;
  tag: string;
  tone: Tone;
  left?: Column;
  right?: Column;
  plot?: Plot;
  /** Where to seat the card relative to the neighbouring columns. */
  seat: "forward" | "between" | "loss";
}

export type Port =
  | { kind: "neuron"; l: number; j: number }
  | { kind: "row"; id: string }
  | { kind: "loss" }
  | { kind: "input"; j: number };

export interface Pulse {
  id: string;
  from: Port;
  to: Port;
  tone: Tone;
  window: [number, number];
  /** Stop part way along, used when a gradient lands on an edge. */
  stop?: number;
  startLabel?: string;
  endLabel?: string;
  /** Fixed label sitting on the edge, such as its weight. */
  chip?: string;
  /** Base edge this pulse travels over: [l, j, i]. */
  edge?: [number, number, number];
  /** Keep the line lit after the pulse has passed. */
  persist?: boolean;
}

export interface NeuronFx {
  l: number;
  j: number;
  window: [number, number];
}

export interface EdgeMorph {
  l: number;
  j: number;
  i: number;
  from: number;
  to: number;
  window: [number, number];
}

export interface ChainLink {
  kind: "loss" | "edge" | "neuron";
  edge?: [number, number, number];
  neuron?: [number, number];
  label: string;
  value: number;
  window: [number, number];
}

export interface Chain {
  links: ChainLink[];
  product: number;
  total: number;
}

export interface Scene {
  /** Null keeps the whole network at full strength. */
  focus: { neurons: string[]; edges: string[]; loss: boolean } | null;
  card?: Card;
  pulses: Pulse[];
  neuronFx: NeuronFx[];
  edgeMorphs: EdgeMorph[];
  chain?: Chain;
  lossFx?: [number, number];
}

/** What the learner has been shown so far. Null means "not computed yet". */
export interface Snapshot {
  w: number[][][];
  b: number[][];
  a: (number | null)[][];
  z: (number | null)[][];
  delta: (number | null)[][];
  gradW: (number | null)[][][];
  gradB: (number | null)[][];
  /** Weights already moved in this iteration, for the green settle. */
  updated: boolean[][];
  loss: number | null;
}

export interface Step {
  id: string;
  phase: Phase;
  title: string;
  body: string;
  math: string[];
  note?: string;
  duration: number;
  scene: Scene;
  before: Snapshot;
  after: Snapshot;
}

export type Detail = "neuron" | "layer";

export interface StepCopy {
  title?: string;
  body?: string;
  note?: string;
}

export interface TimelineOptions {
  spec: NetSpec;
  params: Params;
  sample: Sample;
  detail: Detail;
  inputNames?: string[];
  /** Digits used in the narration. The stage always uses fewer. */
  digits?: number;
  /** Hand-written copy that replaces the generated text, by step id. */
  copy?: Record<string, StepCopy>;
  intro?: boolean;
}

export interface Timeline {
  steps: Step[];
  trace: Trace;
  nextParams: Params;
  nextTrace: Trace;
}

/* ---------- formatting ---------- */

const SUB = "₀₁₂₃₄₅₆₇₈₉";
export const sub = (n: number) => String(n).replace(/\d/g, (d) => SUB[+d]);

export function num(n: number, d = 3) {
  const abs = Math.abs(n);
  if (abs >= 10000 || (abs > 0 && abs < 1e-4 && d >= 3)) return n.toExponential(1).replace("-", "−");
  const s = abs.toFixed(d);
  const isZero = Number(s) === 0;
  return (n < 0 && !isZero ? "−" : "") + s;
}

/** Same as num, but pads positives so columns of figures line up. */
const pad = (n: number, d = 3) => {
  const s = num(n, d);
  return s.startsWith("−") ? s : ` ${s}`;
};

const tex = (n: number, d: number) => num(n, d).replace("−", "-");
const texP = (n: number, d: number) => (n < 0 ? `(${tex(n, d)})` : tex(n, d));

export const ACTIVATION_SYMBOL = {
  sigmoid: "σ",
  tanh: "tanh",
  relu: "ReLU",
  leakyRelu: "LeakyReLU",
  linear: "linear",
  softmax: "softmax",
} as const;

const ACTIVATION_TEX = {
  sigmoid: "\\sigma",
  tanh: "\\tanh",
  relu: "\\mathrm{ReLU}",
  leakyRelu: "\\mathrm{LReLU}",
  linear: "\\mathrm{id}",
  softmax: "\\mathrm{softmax}",
} as const;

export const LOSS_LABEL = { bce: "Binary cross-entropy", cce: "Categorical cross-entropy", mse: "Mean squared error" };

const lossTex = {
  bce: "L = -\\big[\\,y\\log\\hat y + (1-y)\\log(1-\\hat y)\\,\\big]",
  cce: "L = -\\sum_k y_k \\log \\hat y_k",
  mse: "L = \\frac{1}{K}\\sum_k (\\hat y_k - y_k)^2",
};

export function neuronName(spec: NetSpec, l: number, j: number) {
  const L = spec.sizes.length - 1;
  if (l === 0) return `x${sub(j + 1)}`;
  if (l === L) return spec.sizes[L] === 1 ? "ŷ" : `ŷ${sub(j + 1)}`;
  return L === 2 ? `h${sub(j + 1)}` : `h${sub(l)}.${sub(j + 1)}`;
}

export const nid = (l: number, j: number) => `${l}:${j}`;
export const eid = (l: number, j: number, i: number) => `${l}:${j}:${i}`;

/* ---------- compiler ---------- */

/** Width in characters of a "w × a = result" row in each column. */
const FWD_CH = 23;
const GATHER_CH = 23;
const HAND_CH = 25;

const texSym = (s: string, l: number, j: number) => `${s}^{(${l})}_{${j + 1}}`;

export function buildTimeline(opts: TimelineOptions): Timeline {
  const { spec, params, sample, detail } = opts;
  const digits = opts.digits ?? 4;
  const sizes = spec.sizes;
  const L = sizes.length - 1;
  const trace = run(spec, params, sample);
  const nextParams = applyGradients(spec, params, trace);
  const nextTrace = run(spec, nextParams, sample);
  const lr = spec.learningRate;
  const phi = (l: number) => (l === L ? spec.outputActivation : spec.hiddenActivation);
  const name = (l: number, j: number) => neuronName(spec, l, j);

  const steps: Step[] = [];
  let snap: Snapshot = {
    w: params.w,
    b: params.b,
    a: sizes.map((n) => Array(n).fill(null)),
    z: sizes.map((n) => Array(n).fill(null)),
    delta: sizes.map((n) => Array(n).fill(null)),
    gradW: params.w.map((layer) => layer.map((row) => row.map(() => null))),
    gradB: params.b.map((layer) => layer.map(() => null)),
    updated: sizes.map((n) => Array(n).fill(false)),
    loss: null,
  };

  const emit = (
    id: string,
    phase: Phase,
    content: { title: string; body: string; math: string[]; note?: string },
    duration: number,
    scene: Partial<Scene>,
    mutate?: (s: Snapshot) => void,
  ) => {
    const after = structuredClone(snap);
    mutate?.(after);
    const copy = opts.copy?.[id];
    steps.push({
      id,
      phase,
      title: copy?.title ?? content.title,
      body: copy?.body ?? content.body,
      math: content.math,
      note: copy?.note ?? content.note,
      duration,
      scene: { focus: null, pulses: [], neuronFx: [], edgeMorphs: [], ...scene },
      before: snap,
      after,
    });
    snap = after;
  };

  const allNeurons = (l: number) => Array.from({ length: sizes[l] }, (_, j) => nid(l, j));
  const edgesInto = (l: number, j: number) => Array.from({ length: sizes[l - 1] }, (_, i) => eid(l, j, i));
  const allEdgesInto = (l: number) => allNeurons(l).flatMap((_, j) => edgesInto(l, j));

  /* ----- setup ----- */

  if (opts.intro) {
    emit(
      "setup",
      "setup",
      {
        title: "The network before it has seen anything",
        body: "Every line is a weight and every circle is a neuron. Blue lines are positive weights, pink lines are negative, and thicker means larger. Nothing has been computed yet.",
        math: [],
      },
      700,
      {},
    );
  }

  /* ----- input ----- */

  emit(
    "input",
    "forward",
    {
      title: "Input values enter the network",
      body: "The input layer does no math. It holds the features of this one example and hands them to the next layer.",
      math: [`X = [${sample.x.map((v) => tex(v, 2)).join(",\\ ")}]`],
    },
    1500,
    {
      focus: { neurons: allNeurons(0), edges: [], loss: false },
      pulses: sample.x.map((v, j) => ({
        id: `in${j}`,
        from: { kind: "input", j } as Port,
        to: { kind: "neuron", l: 0, j } as Port,
        tone: "signal" as Tone,
        window: [0.05 + (j * 0.5) / sizes[0], 0.35 + (j * 0.5) / sizes[0]] as [number, number],
        endLabel: num(v, 2),
      })),
      neuronFx: sample.x.map((_, j) => ({
        l: 0,
        j,
        window: [0.3 + (j * 0.5) / sizes[0], 0.45 + (j * 0.5) / sizes[0]] as [number, number],
      })),
    },
    (s) => {
      s.a[0] = sample.x.slice();
    },
  );

  /* ----- forward ----- */

  const forwardNeuron = (l: number, j: number) => {
    const K = sizes[l - 1];
    const prev = trace.a[l - 1];
    const w = params.w[l][j];
    const b = params.b[l][j];
    const z = trace.z[l][j];
    const act = phi(l);
    const isSoftmax = act === "softmax";
    const value = trace.a[l][j];
    const termEnd = 0.56;
    const slot = (termEnd - 0.1) / K;

    const rows: Row[] = w.map((wi, i) => ({
      id: `t${i}`,
      at: 0.1 + slot * (i + 1.25),
      kind: "term",
      spans: [
        { t: pad(wi, 2), tone: "muted" },
        { t: " × ", tone: "muted" },
        { t: pad(prev[i], 3), tone: "signal" },
        { t: " = ", tone: "muted" },
        { t: pad(wi * prev[i], 3) },
      ],
    }));
    rows.push({
      id: "bias",
      at: 0.6,
      kind: "term",
      spans: [{ t: "bias", tone: "muted" }],
      trail: [{ t: "+ ", tone: "muted" }, { t: num(b, 3) }],
      trailCh: FWD_CH,
    });
    rows.push({
      id: "sum",
      at: 0.67,
      kind: "total",
      spans: [{ t: "z", tone: "plain" }],
      trail: [{ t: "= ", tone: "muted" }, { t: num(z, 3), tone: "signal" }],
      trailCh: FWD_CH,
    });

    const terms = w.map((wi, i) => `${texP(wi, 2)}(${tex(prev[i], l === 1 ? 2 : digits)})`).join(" + ");
    const math = [
      `${texSym("z", l, j)} = ${terms} ${b < 0 ? "-" : "+"} ${tex(Math.abs(b), 2)} = ${tex(z, digits)}`,
    ];
    if (!isSoftmax) {
      math.push(`${texSym("a", l, j)} = ${ACTIVATION_TEX[act]}(${tex(z, digits)}) = ${tex(value, digits)}`);
    }

    const who = l === L ? "The output neuron" : `Hidden neuron ${name(l, j)}`;
    emit(
      `fwd:${l}:${j}`,
      "forward",
      {
        title: `${who} computes its value`,
        body:
          `Each incoming signal is multiplied by the weight on its line. The neuron adds those products and its own bias to get $z$` +
          (isSoftmax
            ? ", its raw score. Softmax needs every score, so it runs once all output neurons are done."
            : `, then passes $z$ through ${act === "linear" ? "no activation at all, so the value stays as it is." : `${ACTIVATION_SYMBOL[act]} to get its output.`}`),
        math,
      },
      1500 + K * 620 + (isSoftmax ? 300 : 1700),
      {
        focus: { neurons: [...allNeurons(l - 1), nid(l, j)], edges: [], loss: false },
        card: {
          anchor: { kind: "neuron", l, j },
          title: name(l, j),
          tag: isSoftmax ? "weighted sum" : `weighted sum, then ${ACTIVATION_SYMBOL[act]}`,
          tone: "signal",
          seat: "forward",
          left: { heading: "weight × input", rows, width: 196 },
          plot: isSoftmax
            ? undefined
            : { kind: "activation", fn: act as "sigmoid", z, value, window: [0.72, 0.96] },
        },
        pulses: w.map((wi, i) => ({
          id: `f${i}`,
          from: { kind: "neuron", l: l - 1, j: i } as Port,
          to: { kind: "row", id: `t${i}` } as Port,
          tone: "signal" as Tone,
          edge: [l, j, i] as [number, number, number],
          window: [0.1 + slot * i, 0.1 + slot * (i + 1.25)] as [number, number],
          startLabel: num(prev[i], 2),
          endLabel: num(wi * prev[i], 3),
          chip: `w ${num(wi, 2)}`,
          persist: true,
        })),
      },
      (s) => {
        s.z[l][j] = z;
        if (!isSoftmax) s.a[l][j] = value;
      },
    );
  };

  const forwardLayer = (l: number) => {
    const act = phi(l);
    emit(
      `fwd:${l}`,
      "forward",
      {
        title: l === L ? "The output layer computes its values" : `Hidden layer ${l} computes its values`,
        body: "Every neuron in this layer does the same two things at once: a weighted sum of the previous layer plus its bias, then the activation.",
        math: [
          `Z^{(${l})} = W^{(${l})}A^{(${l - 1})} + b^{(${l})}`,
          `A^{(${l})} = ${ACTIVATION_TEX[act]}\\big(Z^{(${l})}\\big)`,
        ],
      },
      2400,
      {
        focus: { neurons: [...allNeurons(l - 1), ...allNeurons(l)], edges: allEdgesInto(l), loss: false },
        pulses: allNeurons(l).flatMap((_, j) =>
          params.w[l][j].map((_w, i) => ({
            id: `f${j}-${i}`,
            from: { kind: "neuron", l: l - 1, j: i } as Port,
            to: { kind: "neuron", l, j } as Port,
            tone: "signal" as Tone,
            edge: [l, j, i] as [number, number, number],
            window: [0.05 + 0.02 * i, 0.6 + 0.02 * i] as [number, number],
            persist: true,
          })),
        ),
        neuronFx: allNeurons(l).map((_, j) => ({ l, j, window: [0.6, 0.9] as [number, number] })),
      },
      (s) => {
        s.z[l] = trace.z[l].slice();
        s.a[l] = trace.a[l].slice();
      },
    );
  };

  for (let l = 1; l <= L; l++) {
    if (detail === "neuron") for (let j = 0; j < sizes[l]; j++) forwardNeuron(l, j);
    else forwardLayer(l);
  }

  if (spec.outputActivation === "softmax" && detail === "neuron") {
    const exps = trace.z[L];
    emit(
      "softmax",
      "forward",
      {
        title: "Softmax turns raw scores into probabilities",
        body: "Each score is raised through $e^{z}$ and divided by the total, so the outputs are positive and add up to 1. Raising one score lowers every other probability.",
        math: [`\\hat y_k = \\dfrac{e^{z_k}}{\\sum_m e^{z_m}}`],
      },
      2600,
      {
        focus: { neurons: allNeurons(L), edges: [], loss: false },
        neuronFx: allNeurons(L).map((_, j) => ({ l: L, j, window: [0.45, 0.85] as [number, number] })),
        card: {
          anchor: { kind: "neuron", l: L, j: Math.floor(sizes[L] / 2) },
          title: "Softmax",
          tag: "all outputs together",
          tone: "signal",
          seat: "forward",
          left: {
            heading: "score → probability",
            width: 196,
            rows: exps.map((z, k) => ({
              id: `s${k}`,
              at: 0.15 + (k * 0.5) / sizes[L],
              kind: "term" as const,
              spans: [
                { t: `${name(L, k)}`.padEnd(4, " "), tone: "muted" as Tone },
                { t: pad(z, 3) },
                { t: "  →  ", tone: "muted" as Tone },
                { t: num(trace.a[L][k], 3), tone: "signal" as Tone },
              ],
            })),
          },
          plot: { kind: "bars", values: trace.a[L], target: sample.target, window: [0.3, 0.9] },
        },
      },
      (s) => {
        s.a[L] = trace.a[L].slice();
      },
    );
  }

  /* ----- loss ----- */

  const y = sample.target;
  const yh = trace.yhat;
  const lossRows: Row[] = [];
  const lossSub: string[] = [];
  if (spec.loss === "bce") {
    const useful = y[0] === 1 ? `−log(${num(yh[0], 3)})` : `−log(1 − ${num(yh[0], 3)})`;
    lossRows.push(
      { id: "l0", at: 0.42, spans: [{ t: `y = ${num(y[0], 0)}`, tone: "muted" }, { t: `   ŷ = ${num(yh[0], 3)}`, tone: "signal" }] },
      { id: "l1", at: 0.54, spans: [{ t: "L = ", tone: "muted" }, { t: useful }] },
    );
    lossSub.push(
      `L = -\\big[\\,${y[0]}\\log(${tex(yh[0], digits)}) + ${1 - y[0]}\\log(1-${tex(yh[0], digits)})\\,\\big]`,
    );
  } else if (spec.loss === "cce") {
    const k = y.indexOf(1);
    lossRows.push(
      { id: "l0", at: 0.42, spans: [{ t: `true class ${k + 1}`, tone: "muted" }] },
      { id: "l1", at: 0.54, spans: [{ t: "L = ", tone: "muted" }, { t: `−log(${num(yh[k], 3)})` }] },
    );
    lossSub.push(`L = -\\log(${tex(yh[k], digits)})`);
  } else {
    y.forEach((tk, k) =>
      lossRows.push({
        id: `l${k}`,
        at: 0.35 + (k * 0.25) / y.length,
        spans: [
          { t: `(${num(yh[k], 3)} − ${num(tk, 2)})²`, tone: "muted" },
          { t: ` = ${num((yh[k] - tk) ** 2, 3)}` },
        ],
      }),
    );
    if (y.length > 1)
      lossRows.push({ id: "lm", at: 0.62, spans: [{ t: `average of ${y.length}`, tone: "muted" }] });
    lossSub.push(
      `L = \\frac{1}{${y.length}}\\big[${y.map((tk, k) => `(${tex(yh[k], digits)} - ${tex(tk, 2)})^2`).join(" + ")}\\big]`,
    );
  }
  lossRows.push({
    id: "lr",
    at: 0.72,
    kind: "result",
    spans: [{ t: "Loss = ", tone: "muted" }, { t: num(trace.loss, 4), tone: "loss" }],
  });

  emit(
    "loss",
    "loss",
    {
      title: "The prediction is compared with the truth",
      body:
        spec.loss === "mse"
          ? "The loss squares the gap between prediction and target, so large misses count far more than small ones."
          : "The loss only looks at the probability given to the correct answer. Close to 1 costs almost nothing. Close to 0 costs a lot.",
      math: [lossTex[spec.loss], ...lossSub, `L = ${tex(trace.loss, digits)}`],
    },
    3400,
    {
      focus: { neurons: allNeurons(L), edges: [], loss: true },
      lossFx: [0.72, 0.9],
      card: {
        anchor: { kind: "loss" },
        title: "Loss",
        tag: LOSS_LABEL[spec.loss],
        tone: "loss",
        seat: "loss",
        left: { heading: "how wrong was it?", rows: lossRows, width: 250 },
        plot:
          spec.loss === "bce"
            ? { kind: "lossCurve", y: y[0], yhat: yh[0], window: [0.5, 0.86] }
            : undefined,
      },
      pulses: yh.map((v, k) => ({
        id: `l${k}`,
        from: { kind: "neuron", l: L, j: k } as Port,
        to: { kind: "row", id: "l0" } as Port,
        tone: "signal" as Tone,
        window: [0.1 + 0.04 * k, 0.4 + 0.04 * k] as [number, number],
        startLabel: num(v, 3),
      })),
    },
    (s) => {
      s.loss = trace.loss;
    },
  );

  /* ----- backward ----- */

  const shortcut =
    (spec.loss === "bce" && spec.outputActivation === "sigmoid") ||
    (spec.loss === "cce" && spec.outputActivation === "softmax");

  const backwardNeuron = (l: number, j: number) => {
    const delta = trace.delta[l][j];
    const prev = trace.a[l - 1];
    const K = sizes[l - 1];
    const rightRows: Row[] = [];
    const leftRows: Row[] = [];
    const pulses: Pulse[] = [];
    const math: string[] = [];
    let body: string;
    let note: string | undefined;

    const gatherEnd = 0.46;

    if (l === L) {
      const dLdy = trace.dLdy[j];
      if (shortcut) {
        rightRows.push({
          id: "src0",
          at: 0.26,
          kind: "term",
          spans: [
            { t: num(trace.yhat[j], 3), tone: "signal" },
            { t: " − ", tone: "muted" },
            { t: num(y[j], 3), tone: "muted" },
          ],
        });
        math.push(
          `\\delta^{(${L})}_{${j + 1}} = \\dfrac{\\partial L}{\\partial z^{(${L})}_{${j + 1}}} = \\hat y - y = ${tex(trace.yhat[j], digits)} - ${tex(y[j], 0)} = ${tex(delta, digits)}`,
        );
        body =
          "Cross-entropy and its output activation cancel out neatly: the gradient at the output is simply prediction minus truth. A negative value says that raising $z$ would lower the loss.";
      } else {
        const slope = dLdy === 0 ? 0 : delta / dLdy;
        rightRows.push(
          {
            id: "src0",
            at: 0.24,
            kind: "term",
            spans: [{ t: "∂L/∂ŷ", tone: "muted" }],
            trail: [{ t: num(dLdy, 3) }],
            trailCh: 15,
          },
          {
            id: "src1",
            at: 0.34,
            kind: "term",
            spans: [{ t: "∂ŷ/∂z", tone: "muted" }],
            trail: [{ t: "× ", tone: "muted" }, { t: num(slope, 3) }],
            trailCh: 15,
          },
        );
        math.push(
          `\\delta^{(${L})}_{${j + 1}} = \\dfrac{\\partial L}{\\partial \\hat y}\\cdot\\dfrac{\\partial \\hat y}{\\partial z} = ${texP(dLdy, digits)}\\cdot ${texP(slope, digits)} = ${tex(delta, digits)}`,
        );
        body = "The gradient starts at the loss. First ask how the loss reacts to the prediction, then how the prediction reacts to this neuron's $z$, and multiply.";
      }
      pulses.push({
        id: "fromloss",
        from: { kind: "loss" },
        to: { kind: "row", id: "src0" },
        tone: "grad",
        window: [0.08, 0.26],
        startLabel: "L",
      });
    } else {
      const K2 = sizes[l + 1];
      const slot = (gatherEnd - 0.1) / (K2 + 2);
      const act = spec.hiddenActivation;
      const slope = trace.phiPrime[l][j];
      let sum = 0;
      for (let k = 0; k < K2; k++) {
        const d = trace.delta[l + 1][k];
        const w = params.w[l + 1][k][j];
        sum += d * w;
        rightRows.push({
          id: `src${k}`,
          at: 0.1 + slot * (k + 1.25),
          kind: "term",
          spans: [
            { t: pad(d, 3), tone: "grad" },
            { t: " × ", tone: "muted" },
            { t: pad(w, 2), tone: "muted" },
            { t: " = ", tone: "muted" },
            { t: pad(d * w, 3) },
          ],
        });
        pulses.push({
          id: `b${k}`,
          from: { kind: "neuron", l: l + 1, j: k },
          to: { kind: "row", id: `src${k}` },
          tone: "grad",
          edge: [l + 1, k, j],
          window: [0.1 + slot * k, 0.1 + slot * (k + 1.25)],
          startLabel: num(d, 3),
          endLabel: num(d * w, 3),
          chip: `w ${num(w, 2)}`,
          persist: true,
        });
      }
      if (K2 > 1) {
        rightRows.push({
          id: "gsum",
          at: 0.1 + slot * (K2 + 0.6),
          kind: "total",
          spans: [{ t: "sum", tone: "muted" }],
          trail: [{ t: "= ", tone: "muted" }, { t: num(sum, 3) }],
          trailCh: GATHER_CH,
        });
      }
      rightRows.push({
        id: "gphi",
        at: gatherEnd,
        kind: "term",
        spans: [{ t: `slope of ${ACTIVATION_SYMBOL[act]}`, tone: "muted" }],
        trail: [{ t: "× ", tone: "muted" }, { t: num(slope, 3) }],
        trailCh: GATHER_CH,
      });
      const sumTex = trace.delta[l + 1]
        .map((d, k) => `${texP(d, digits)}\\,${texP(params.w[l + 1][k][j], 2)}`)
        .join(" + ");
      math.push(
        `\\delta^{(${l})}_{${j + 1}} = \\Big[${sumTex}\\Big]\\ ${ACTIVATION_TEX[act]}'\\!\\big(z^{(${l})}_{${j + 1}}\\big) = ${tex(delta, digits)}`,
      );
      if (act === "sigmoid") {
        const ai = trace.a[l][j];
        math.push(
          `\\sigma'(z) = a(1-a) = ${tex(ai, digits)} \\times ${tex(1 - ai, digits)} = ${tex(slope, digits)}`,
        );
      }
      body =
        "The error signal arrives from the layer ahead, scaled by each outgoing weight. The neuron adds what arrives and multiplies by the slope of its own activation. That multiplication is the chain rule, one link at a time.";
      if (slope === 0) {
        note = "This neuron's slope is exactly zero, so no gradient can pass through it on this example. That is a dead ReLU: its incoming weights will not move.";
      }
    }

    rightRows.push({
      id: "gdelta",
      at: 0.52,
      kind: "result",
      spans: [{ t: "δ", tone: "plain" }],
      trail: [{ t: "= ", tone: "muted" }, { t: num(delta, 4), tone: "grad" }],
      trailCh: l === L ? 15 : GATHER_CH,
    });

    const slotG = 0.3 / (K + 1);
    const startG = 0.6;
    prev.forEach((ai, i) => {
      const at = startG + slotG * (i + 0.8);
      leftRows.push({
        id: `g${i}`,
        at,
        kind: "term",
        spans: [
          { t: pad(delta, 3), tone: "grad" },
          { t: " × ", tone: "muted" },
          { t: pad(ai, 3), tone: "signal" },
          { t: " = ", tone: "muted" },
          { t: pad(delta * ai, 4), tone: "grad" },
        ],
      });
      pulses.push({
        id: `h${i}`,
        from: { kind: "row", id: `g${i}` },
        to: { kind: "neuron", l: l - 1, j: i },
        tone: "grad",
        edge: [l, j, i],
        window: [at, Math.min(0.97, at + 0.14)],
        stop: 0.6,
        persist: true,
        endLabel: num(delta * ai, 4),
      });
    });
    leftRows.push({
      id: "gb",
      at: startG + slotG * (K + 0.6),
      kind: "term",
      spans: [{ t: "bias", tone: "muted" }],
      trail: [{ t: "= ", tone: "muted" }, { t: num(delta, 4), tone: "grad" }],
      trailCh: HAND_CH,
    });

    const example = `\\dfrac{\\partial L}{\\partial w^{(${l})}_{${j + 1}1}} = \\delta^{(${l})}_{${j + 1}}\\ a^{(${l - 1})}_{1} = ${texP(delta, digits)}\\,(${tex(prev[0], l === 1 ? 2 : digits)}) = ${tex(delta * prev[0], digits)}`;
    math.push(example);

    emit(
      `bwd:${l}:${j}`,
      "backward",
      {
        title:
          l === L
            ? `The gradient starts at ${name(l, j)}`
            : `The gradient reaches ${name(l, j)}`,
        body,
        math,
        note,
      },
      l === L ? 4600 : 2600 + (sizes[l + 1] + K) * 620,
      {
        focus: {
          neurons: [nid(l, j), ...allNeurons(l - 1), ...(l < L ? allNeurons(l + 1) : [])],
          edges: [],
          loss: l === L,
        },
        card: {
          anchor: { kind: "neuron", l, j },
          title: name(l, j),
          tag: "backward",
          tone: "grad",
          seat: "between",
          left: { heading: "2  hand out to each weight", rows: leftRows, width: 196 },
          right: {
            heading: l === L ? "1  from the loss" : "1  gather from the layer ahead",
            rows: rightRows,
            width: l === L ? 124 : 196,
          },
        },
        pulses,
      },
      (s) => {
        s.delta[l][j] = delta;
        s.gradW[l][j] = trace.gradW[l][j].slice();
        s.gradB[l][j] = trace.gradB[l][j];
      },
    );
  };

  const backwardLayer = (l: number) => {
    const edges = l < L ? allEdgesInto(l + 1) : [];
    emit(
      `bwd:${l}`,
      "backward",
      {
        title: l === L ? "The gradient starts at the output layer" : `The gradient reaches hidden layer ${l}`,
        body:
          l === L
            ? "The derivative of the loss with respect to each output's $z$ is the seed for everything that follows."
            : "Each neuron collects the gradient arriving through its outgoing weights and multiplies by its activation slope. Its incoming weight gradients follow from that.",
        math:
          l === L
            ? [`\\delta^{(${L})} = \\partial L / \\partial Z^{(${L})}`]
            : [
                `\\delta^{(${l})} = \\big(W^{(${l + 1})}\\big)^{\\!\\top}\\delta^{(${l + 1})} \\odot ${ACTIVATION_TEX[spec.hiddenActivation]}'\\big(Z^{(${l})}\\big)`,
                `\\dfrac{\\partial L}{\\partial W^{(${l})}} = \\delta^{(${l})}\\big(A^{(${l - 1})}\\big)^{\\!\\top}`,
              ],
      },
      2400,
      {
        focus: {
          neurons: [...allNeurons(l), ...(l < L ? allNeurons(l + 1) : [])],
          edges,
          loss: l === L,
        },
        pulses:
          l === L
            ? allNeurons(L).map((_, j) => ({
                id: `s${j}`,
                from: { kind: "loss" } as Port,
                to: { kind: "neuron", l: L, j } as Port,
                tone: "grad" as Tone,
                window: [0.05, 0.6] as [number, number],
              }))
            : allNeurons(l + 1).flatMap((_, k) =>
                allNeurons(l).map((_u, j) => ({
                  id: `b${k}-${j}`,
                  from: { kind: "neuron", l: l + 1, j: k } as Port,
                  to: { kind: "neuron", l, j } as Port,
                  tone: "grad" as Tone,
                  edge: [l + 1, k, j] as [number, number, number],
                  window: [0.05 + 0.02 * j, 0.6 + 0.02 * j] as [number, number],
                  persist: true,
                })),
              ),
      },
      (s) => {
        s.delta[l] = trace.delta[l].slice();
        s.gradW[l] = trace.gradW[l].map((r) => r.slice());
        s.gradB[l] = trace.gradB[l].slice();
      },
    );
  };

  for (let l = L; l >= 1; l--) {
    if (detail === "neuron") for (let j = 0; j < sizes[l]; j++) backwardNeuron(l, j);
    else backwardLayer(l);
  }

  /* ----- chain rule, one complete path ----- */

  {
    // Trace the strongest path from the loss back to the first weight.
    const route: number[] = [0];
    for (let m = 2; m <= L; m++) {
      const j = route[route.length - 1];
      let best = 0;
      let bestV = -1;
      for (let k = 0; k < sizes[m]; k++) {
        const v = Math.abs(trace.delta[m][k] * params.w[m][k][j]);
        if (v > bestV) {
          bestV = v;
          best = k;
        }
      }
      route.push(best);
    }
    const n = 2 * L;
    const win = (idx: number): [number, number] => [0.06 + (idx * 0.8) / n, 0.06 + ((idx + 0.85) * 0.8) / n];
    const links: ChainLink[] = [];
    let idx = 0;
    links.push({
      kind: "loss",
      neuron: [L, route[L - 1]],
      label: `∂L/∂z ${num(trace.delta[L][route[L - 1]], 3)}`,
      value: trace.delta[L][route[L - 1]],
      window: win(idx++),
    });
    for (let m = L; m >= 2; m--) {
      const k = route[m - 1];
      const j = route[m - 2];
      links.push({
        kind: "edge",
        edge: [m, k, j],
        label: `∂z/∂a ${num(params.w[m][k][j], 3)}`,
        value: params.w[m][k][j],
        window: win(idx++),
      });
      links.push({
        kind: "neuron",
        neuron: [m - 1, j],
        label: `∂a/∂z ${num(trace.phiPrime[m - 1][j], 3)}`,
        value: trace.phiPrime[m - 1][j],
        window: win(idx++),
      });
    }
    links.push({
      kind: "edge",
      edge: [1, 0, 0],
      label: `∂z/∂w ${num(trace.a[0][0], 3)}`,
      value: trace.a[0][0],
      window: win(idx++),
    });
    const product = links.reduce((p, c) => p * c.value, 1);
    const total = trace.gradW[1][0][0];
    const unique = L === 1 ? true : sizes.slice(2).every((s) => s === 1);

    const zL = `z^{(${L})}_{${route[L - 1] + 1}}`;
    const parts: string[] = [`\\dfrac{\\partial L}{\\partial ${zL}}`];
    for (let m = L; m >= 2; m--) {
      const k = route[m - 1];
      const j = route[m - 2];
      parts.push(`\\dfrac{\\partial z^{(${m})}_{${k + 1}}}{\\partial a^{(${m - 1})}_{${j + 1}}}`);
      parts.push(`\\dfrac{\\partial a^{(${m - 1})}_{${j + 1}}}{\\partial z^{(${m - 1})}_{${j + 1}}}`);
    }
    parts.push(`\\dfrac{\\partial z^{(1)}_{1}}{\\partial w^{(1)}_{11}}`);

    emit(
      "chain",
      "backward",
      {
        title: "The chain rule, end to end",
        body: unique
          ? `Here is one weight traced all the way back to the loss. Its gradient is every link on this path multiplied together: ${links.length} slopes, each one already computed by a neuron along the way.`
          : `Here is the strongest path from the loss to one weight. A weight's full gradient adds up every path, and this one contributes ${num(product, 4)} of the total ${num(total, 4)}.`,
        math: [
          `\\dfrac{\\partial L}{\\partial w^{(1)}_{11}} ${unique ? "=" : "\\ni"} ${parts.join("\\cdot")}`,
          `${unique ? "" : "\\text{this path: }"}${links.map((c) => texP(c.value, digits)).join("\\cdot ")} = ${tex(product, digits)}`,
        ],
      },
      1000 + links.length * 1000,
      {
        focus: {
          neurons: [
            nid(0, 0),
            ...route.map((j, idx2) => nid(idx2 + 1, j)),
          ],
          edges: links.filter((c) => c.edge).map((c) => eid(...c.edge!)),
          loss: true,
        },
        chain: { links, product, total },
      },
    );
  }

  /* ----- update ----- */

  const updateNeuron = (l: number, j: number) => {
    const K = sizes[l - 1];
    const rows: Row[] = [];
    const morphs: EdgeMorph[] = [];
    const pulses: Pulse[] = [];
    const slot = 0.62 / (K + 1);
    params.w[l][j].forEach((w, i) => {
      const g = trace.gradW[l][j][i];
      const nw = nextParams.w[l][j][i];
      const at = 0.14 + slot * (i + 0.8);
      rows.push({
        id: `u${i}`,
        at,
        kind: "term",
        spans: [
          { t: pad(w, 3), tone: "muted" },
          { t: ` − ${num(lr, lr < 0.01 ? 3 : 2)}×`, tone: "muted" },
          { t: `(${num(g, 4)})`.padEnd(9, " "), tone: "grad" },
          { t: " → ", tone: "muted" },
          { t: pad(nw, 4), tone: "update" },
        ],
      });
      morphs.push({ l, j, i, from: w, to: nw, window: [at - 0.05, at + 0.2] });
      pulses.push({
        id: `u${i}`,
        from: { kind: "row", id: `u${i}` },
        to: { kind: "neuron", l: l - 1, j: i },
        tone: "update",
        edge: [l, j, i],
        window: [at, Math.min(0.97, at + 0.16)],
        stop: 0.5,
        persist: true,
        endLabel: `${num(w, 3)} → ${num(nw, 3)}`,
      });
    });
    const b = params.b[l][j];
    const nb = nextParams.b[l][j];
    rows.push({
      id: "ub",
      at: 0.14 + slot * (K + 0.6),
      kind: "term",
      spans: [
        { t: pad(b, 3), tone: "muted" },
        { t: ` − ${num(lr, lr < 0.01 ? 3 : 2)}×`, tone: "muted" },
        { t: `(${num(trace.gradB[l][j], 4)})`.padEnd(9, " "), tone: "grad" },
        { t: " → ", tone: "muted" },
        { t: pad(nb, 4), tone: "update" },
      ],
    });
    emit(
      `upd:${l}:${j}`,
      "update",
      {
        title: `${name(l, j)} updates its weights and bias`,
        body: `Each parameter takes a small step against its gradient. A negative gradient means the weight grows, and a positive gradient means it shrinks. The learning rate ${num(lr, lr < 0.01 ? 3 : 2)} keeps the step small. The thicker a line swells, the more that weight moved compared with its neighbours.`,
        math: [
          `w_{\\text{new}} = w_{\\text{old}} - \\alpha\\,\\dfrac{\\partial L}{\\partial w}`,
          `w^{(${l})}_{${j + 1}1} = ${tex(params.w[l][j][0], digits === 5 ? 2 : 3)} - ${tex(lr, 2)}\\,${texP(trace.gradW[l][j][0], digits)} = ${tex(nextParams.w[l][j][0], digits)}`,
        ],
      },
      1800 + (K + 1) * 700,
      {
        focus: { neurons: [nid(l, j), ...allNeurons(l - 1)], edges: [], loss: false },
        card: {
          anchor: { kind: "neuron", l, j },
          title: name(l, j),
          tag: "w − α · gradient",
          tone: "update",
          seat: "forward",
          left: {
            heading: "old value − step → new value",
            rows,
            width: 262,
          },
        },
        pulses,
        edgeMorphs: morphs,
      },
      (s) => {
        s.w[l] = s.w[l].map((row, jj) => (jj === j ? nextParams.w[l][j].slice() : row));
        s.b[l] = s.b[l].map((v, jj) => (jj === j ? nb : v));
        s.gradW[l][j] = s.gradW[l][j].map(() => null);
        s.gradB[l][j] = null;
        s.delta[l][j] = null;
        s.updated[l][j] = true;
      },
    );
  };

  const updateLayer = (l: number) => {
    emit(
      `upd:${l}`,
      "update",
      {
        title: l === L ? "The output weights move" : `Hidden layer ${l} weights move`,
        body: "Every weight in this layer takes a step against its gradient, sized by the learning rate. The thicker a line swells, the more that weight moved compared with the others.",
        math: [
          `W^{(${l})}_{\\text{new}} = W^{(${l})} - ${tex(lr, 2)}\\ \\dfrac{\\partial L}{\\partial W^{(${l})}}`,
          `b^{(${l})}_{\\text{new}} = b^{(${l})} - ${tex(lr, 2)}\\ \\dfrac{\\partial L}{\\partial b^{(${l})}}`,
        ],
      },
      2200,
      {
        focus: { neurons: [...allNeurons(l - 1), ...allNeurons(l)], edges: allEdgesInto(l), loss: false },
        edgeMorphs: params.w[l].flatMap((row, j) =>
          row.map((w, i) => ({ l, j, i, from: w, to: nextParams.w[l][j][i], window: [0.1, 0.8] as [number, number] })),
        ),
      },
      (s) => {
        s.w[l] = nextParams.w[l].map((r) => r.slice());
        s.b[l] = nextParams.b[l].slice();
        s.gradW[l] = s.gradW[l].map((r) => r.map(() => null));
        s.gradB[l] = s.gradB[l].map(() => null);
        s.delta[l] = s.delta[l].map(() => null);
        s.updated[l] = s.updated[l].map(() => true);
      },
    );
  };

  for (let l = L; l >= 1; l--) {
    if (detail === "neuron") for (let j = 0; j < sizes[l]; j++) updateNeuron(l, j);
    else updateLayer(l);
  }

  /* ----- verify ----- */

  const sweepPulses: Pulse[] = [];
  const sweepFx: NeuronFx[] = [];
  for (let l = 1; l <= L; l++) {
    const span = 0.72 / L;
    const start = 0.04 + span * (l - 1);
    allNeurons(l).forEach((_, j) => {
      params.w[l][j].forEach((_w, i) => {
        sweepPulses.push({
          id: `r${l}-${j}-${i}`,
          from: { kind: "neuron", l: l - 1, j: i },
          to: { kind: "neuron", l, j },
          tone: "signal",
          edge: [l, j, i],
          window: [start, start + span * 0.9],
        });
      });
      sweepFx.push({ l, j, window: [start + span * 0.7, start + span * 1.1] });
    });
  }
  yhatPulses(nextTrace.yhat).forEach((p) => sweepPulses.push(p));

  emit(
    "reforward",
    "verify",
    {
      title: "Run the same example through the new weights",
      body: "Same input, same label, new parameters. Everything changed a little, so the signal arrives at a different answer.",
      math: [
        `X = [${sample.x.map((v) => tex(v, 2)).join(",\\ ")}]`,
        sizes[L] === 1
          ? `\\hat y_{\\text{new}} = ${tex(nextTrace.yhat[0], digits)}`
          : `\\hat y_{\\text{new}} = [${nextTrace.yhat.map((v) => tex(v, 3)).join(",\\ ")}]`,
      ],
      note: "All parameters moved together, using gradients from the same forward pass. No weight was updated and then used to compute another weight's gradient.",
    },
    3200,
    {
      pulses: sweepPulses,
      neuronFx: sweepFx,
      lossFx: [0.86, 0.98],
    },
    (s) => {
      s.a = nextTrace.a.map((r) => r.slice());
      s.z = nextTrace.z.map((r) => r.slice());
      s.delta = s.delta.map((r) => r.map(() => null));
      s.updated = s.updated.map((r) => r.map(() => false));
      s.loss = nextTrace.loss;
    },
  );

  const pick = sample.target.length > 1 && spec.loss === "cce" ? sample.target.indexOf(1) : 0;
  const lossDrop = (trace.loss - nextTrace.loss) / trace.loss;
  const improved = nextTrace.loss < trace.loss;
  emit(
    "compare",
    "verify",
    {
      title: improved ? "The loss went down" : "The loss went up",
      body: improved
        ? "One small step, and the network is a little less wrong on this example. Training is this loop repeated thousands of times, across many examples."
        : "The step overshot. With a learning rate this large the update jumped past the lower ground. Try a smaller learning rate and watch it settle.",
      math: [
        `L: ${tex(trace.loss, digits)} \\;\\to\\; ${tex(nextTrace.loss, digits)}`,
        `\\text{change} = ${tex(-lossDrop * 100, 2)}\\%`,
      ],
    },
    2600,
    {
      focus: { neurons: allNeurons(L), edges: [], loss: true },
      card: {
        anchor: { kind: "loss" },
        title: "Before → after",
        tag: "one training step",
        tone: improved ? "update" : "loss",
        seat: "loss",
        left: {
          heading: "same example, new weights",
          width: 250,
          rows: [
            {
              id: "c0",
              at: 0.15,
              spans: [
                { t: "prediction  ", tone: "muted" },
                { t: num(trace.yhat[pick], 4), tone: "muted" },
                { t: " → ", tone: "muted" },
                { t: num(nextTrace.yhat[pick], 4), tone: "signal" },
              ],
            },
            {
              id: "c1",
              at: 0.35,
              spans: [
                { t: "loss        ", tone: "muted" },
                { t: num(trace.loss, 4), tone: "muted" },
                { t: " → ", tone: "muted" },
                { t: num(nextTrace.loss, 4), tone: improved ? "update" : "loss" },
              ],
            },
            {
              id: "c2",
              at: 0.6,
              kind: "result",
              spans: [
                { t: "change      ", tone: "muted" },
                { t: `${num(-lossDrop * 100, 2)}%`, tone: improved ? "update" : "loss" },
              ],
            },
          ],
        },
      },
    },
  );

  function yhatPulses(values: number[]): Pulse[] {
    return values.map((v, k) => ({
      id: `rl${k}`,
      from: { kind: "neuron", l: L, j: k },
      to: { kind: "loss" },
      tone: "signal",
      window: [0.76, 0.92],
      startLabel: num(v, 3),
    }));
  }

  return { steps, trace, nextParams, nextTrace };
}
