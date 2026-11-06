/**
 * Pure math for a fully connected network. No React, no animation: the
 * timeline compiler reads the trace produced here and decides how to show it.
 *
 * Indexing convention, used everywhere:
 *   layer 0 is the input, layer L is the output.
 *   w[l][j][i]  weight into neuron j of layer l, from neuron i of layer l-1
 *   b[l][j]     bias of neuron j of layer l
 *   delta[l][j] the gradient of the loss with respect to z[l][j]
 */

export type HiddenActivation = "sigmoid" | "tanh" | "relu" | "leakyRelu";
export type OutputActivation = "sigmoid" | "softmax" | "linear";
export type LossName = "bce" | "cce" | "mse";

export interface NetSpec {
  /** Neurons per layer, input first, e.g. [3, 4, 1]. */
  sizes: number[];
  hiddenActivation: HiddenActivation;
  outputActivation: OutputActivation;
  loss: LossName;
  learningRate: number;
}

export interface Params {
  w: number[][][];
  b: number[][];
}

export interface Sample {
  x: number[];
  /** One target per output neuron (one-hot for multi-class). */
  target: number[];
}

export interface Trace {
  /** z[l][j], the weighted sum. z[0] is unused and empty. */
  z: number[][];
  /** a[l][j], the neuron output. a[0] is the input vector. */
  a: number[][];
  yhat: number[];
  loss: number;
  /** dL/dyhat[k], the slope of the loss for each output. */
  dLdy: number[];
  /** phiPrime[l][j], the slope of the activation at z[l][j]. Hidden layers only. */
  phiPrime: number[][];
  delta: number[][];
  gradW: number[][][];
  gradB: number[][];
}

const EPS = 1e-12;

export function activate(name: HiddenActivation | "linear", z: number): number {
  switch (name) {
    case "sigmoid":
      return 1 / (1 + Math.exp(-z));
    case "tanh":
      return Math.tanh(z);
    case "relu":
      return Math.max(0, z);
    case "leakyRelu":
      return z > 0 ? z : 0.01 * z;
    case "linear":
      return z;
  }
}

export function activationSlope(name: HiddenActivation | "linear", z: number): number {
  switch (name) {
    case "sigmoid": {
      const s = activate("sigmoid", z);
      return s * (1 - s);
    }
    case "tanh": {
      const t = Math.tanh(z);
      return 1 - t * t;
    }
    case "relu":
      return z > 0 ? 1 : 0;
    case "leakyRelu":
      return z > 0 ? 1 : 0.01;
    case "linear":
      return 1;
  }
}

export function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const exps = z.map((v) => Math.exp(v - m));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

function clampProb(p: number) {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

export function lossValue(name: LossName, yhat: number[], t: number[]): number {
  switch (name) {
    case "bce": {
      const p = clampProb(yhat[0]);
      return -(t[0] * Math.log(p) + (1 - t[0]) * Math.log(1 - p));
    }
    case "cce":
      return -t.reduce((s, tk, k) => s + tk * Math.log(clampProb(yhat[k])), 0);
    case "mse":
      return t.reduce((s, tk, k) => s + (yhat[k] - tk) ** 2, 0) / t.length;
  }
}

function lossSlope(name: LossName, yhat: number[], t: number[]): number[] {
  switch (name) {
    case "bce": {
      const p = clampProb(yhat[0]);
      return [(1 - t[0]) / (1 - p) - t[0] / p];
    }
    case "cce":
      return t.map((tk, k) => -tk / clampProb(yhat[k]));
    case "mse":
      return t.map((tk, k) => (2 / t.length) * (yhat[k] - tk));
  }
}

export function forward(spec: NetSpec, params: Params, x: number[]) {
  const L = spec.sizes.length - 1;
  const a: number[][] = [x.slice()];
  const z: number[][] = [[]];
  for (let l = 1; l <= L; l++) {
    const zl = params.w[l].map((row, j) =>
      row.reduce((s, wji, i) => s + wji * a[l - 1][i], params.b[l][j]),
    );
    z[l] = zl;
    if (l < L) a[l] = zl.map((v) => activate(spec.hiddenActivation, v));
    else if (spec.outputActivation === "softmax") a[l] = softmax(zl);
    else a[l] = zl.map((v) => activate(spec.outputActivation as "sigmoid" | "linear", v));
  }
  return { a, z };
}

export function run(spec: NetSpec, params: Params, sample: Sample): Trace {
  const L = spec.sizes.length - 1;
  const { a, z } = forward(spec, params, sample.x);
  const yhat = a[L];
  const loss = lossValue(spec.loss, yhat, sample.target);
  const dLdy = lossSlope(spec.loss, yhat, sample.target);

  const delta: number[][] = [];
  const phiPrime: number[][] = [];
  if (spec.outputActivation === "softmax") {
    delta[L] = yhat.map((_, k) =>
      dLdy.reduce((s, g, m) => s + g * yhat[m] * ((m === k ? 1 : 0) - yhat[k]), 0),
    );
  } else {
    delta[L] = dLdy.map(
      (g, k) => g * activationSlope(spec.outputActivation as "sigmoid" | "linear", z[L][k]),
    );
  }

  for (let l = L - 1; l >= 1; l--) {
    phiPrime[l] = z[l].map((v) => activationSlope(spec.hiddenActivation, v));
    delta[l] = z[l].map((_, j) => {
      const sum = delta[l + 1].reduce((s, dk, k) => s + dk * params.w[l + 1][k][j], 0);
      return sum * phiPrime[l][j];
    });
  }

  const gradW: number[][][] = [[]];
  const gradB: number[][] = [[]];
  for (let l = 1; l <= L; l++) {
    gradW[l] = delta[l].map((dj) => a[l - 1].map((ai) => dj * ai));
    gradB[l] = delta[l].slice();
  }
  phiPrime[0] = [];
  phiPrime[L] = [];
  delta[0] = [];

  return { z, a, yhat, loss, dLdy, phiPrime, delta, gradW, gradB };
}

/** Every parameter moves at once, using gradients from the same forward pass. */
export function applyGradients(spec: NetSpec, params: Params, trace: Trace): Params {
  const lr = spec.learningRate;
  return {
    w: params.w.map((layer, l) =>
      layer.map((row, j) => row.map((v, i) => v - lr * trace.gradW[l][j][i])),
    ),
    b: params.b.map((layer, l) => layer.map((v, j) => v - lr * trace.gradB[l][j])),
  };
}

export function parameterCount(sizes: number[]) {
  let weights = 0;
  let biases = 0;
  for (let l = 1; l < sizes.length; l++) {
    weights += sizes[l - 1] * sizes[l];
    biases += sizes[l];
  }
  return { weights, biases, total: weights + biases };
}

/** Small seeded generator so a configuration reproduces its starting weights. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomParams(sizes: number[], seed: number): Params {
  const rnd = mulberry32(seed);
  const draw = (scale: number) => Math.round((rnd() * 2 - 1) * scale * 100) / 100;
  const w: number[][][] = [[]];
  const b: number[][] = [[]];
  for (let l = 1; l < sizes.length; l++) {
    w[l] = Array.from({ length: sizes[l] }, () =>
      Array.from({ length: sizes[l - 1] }, () => draw(0.6)),
    );
    b[l] = Array.from({ length: sizes[l] }, () => draw(0.2));
  }
  return { w, b };
}
