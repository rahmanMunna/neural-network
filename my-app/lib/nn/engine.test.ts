import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyGradients,
  forward,
  lossValue,
  parameterCount,
  randomParams,
  run,
  softmax,
} from "./engine.ts";
import type { NetSpec, Params, Sample } from "./engine.ts";
import { exampleParams, exampleSample, exampleSpec } from "./example.ts";

const close = (a: number, b: number, tol = 6e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const closeAll = (a: number[], b: number[], tol?: number) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i], tol));
};

test("worked example: forward pass", () => {
  const t = run(exampleSpec, exampleParams, exampleSample);
  closeAll(t.z[1], [0.15, 0, 0.25, 0.45]);
  closeAll(t.a[1], [0.53743, 0.5, 0.56218, 0.61064]);
  close(t.z[2][0], 0.13957);
  close(t.yhat[0], 0.53484);
  close(t.loss, 0.62579);
});

test("worked example: backward pass", () => {
  const t = run(exampleSpec, exampleParams, exampleSample);
  close(t.delta[2][0], -0.46516);
  closeAll(t.gradW[2][0], [-0.24999, -0.23258, -0.2615, -0.28405]);
  closeAll(t.delta[1], [-0.03469, 0.02326, -0.01145, -0.02212]);
  closeAll(t.gradW[1][0], [-0.03469, -0.01735, -0.05204]);
  closeAll(t.gradW[1][1], [0.02326, 0.01163, 0.03489]);
  closeAll(t.gradW[1][2], [-0.01145, -0.00572, -0.01717]);
  closeAll(t.gradW[1][3], [-0.02212, -0.01106, -0.03318]);
});

test("worked example: update and second forward pass", () => {
  const t = run(exampleSpec, exampleParams, exampleSample);
  const next = applyGradients(exampleSpec, exampleParams, t);
  closeAll(next.w[2][0], [0.324999, -0.176742, 0.12615, 0.228405], 2e-6);
  close(next.b[2][0], -0.05348);
  closeAll(next.b[1], [0.10347, -0.00233, -0.09886, 0.05221]);
  close(next.w[1][0][0], 0.10347);

  const after = run(exampleSpec, next, exampleSample);
  console.log("second pass yhat", after.yhat[0], "loss", after.loss);
  assert.ok(after.loss < t.loss);
});

test("parameter count matches the worked example", () => {
  assert.deepEqual(parameterCount([3, 4, 1]), { weights: 16, biases: 5, total: 21 });
});

/** Central differences against the analytic gradient, for every configuration. */
function gradientCheck(spec: NetSpec, params: Params, sample: Sample) {
  const trace = run(spec, params, sample);
  const h = 1e-6;
  const lossAt = (p: Params) => {
    const { a } = forward(spec, p, sample.x);
    return lossValue(spec.loss, a[a.length - 1], sample.target);
  };
  const clone = (): Params => structuredClone(params);
  for (let l = 1; l < spec.sizes.length; l++) {
    for (let j = 0; j < spec.sizes[l]; j++) {
      for (let i = 0; i < spec.sizes[l - 1]; i++) {
        const up = clone();
        up.w[l][j][i] += h;
        const down = clone();
        down.w[l][j][i] -= h;
        close(trace.gradW[l][j][i], (lossAt(up) - lossAt(down)) / (2 * h), 1e-5);
      }
      const up = clone();
      up.b[l][j] += h;
      const down = clone();
      down.b[l][j] -= h;
      close(trace.gradB[l][j], (lossAt(up) - lossAt(down)) / (2 * h), 1e-5);
    }
  }
}

test("analytic gradients match numerical gradients", () => {
  const configs: Array<[NetSpec, number[]]> = [];
  const lr = { learningRate: 0.1 };
  for (const hiddenActivation of ["sigmoid", "tanh", "relu", "leakyRelu"] as const) {
    const h = { hiddenActivation, ...lr };
    configs.push(
      [{ sizes: [3, 4, 3, 1], outputActivation: "sigmoid", loss: "bce", ...h }, [1]],
      [{ sizes: [3, 4, 1], outputActivation: "sigmoid", loss: "mse", ...h }, [0]],
      [{ sizes: [2, 5, 3], outputActivation: "softmax", loss: "cce", ...h }, [0, 1, 0]],
      [{ sizes: [2, 5, 3], outputActivation: "softmax", loss: "mse", ...h }, [0, 0, 1]],
      [{ sizes: [2, 3, 1], outputActivation: "linear", loss: "mse", ...h }, [0.7]],
      [{ sizes: [4, 1], outputActivation: "sigmoid", loss: "bce", ...h }, [1]],
    );
  }
  configs.forEach(([spec, target], n) => {
    const x = Array.from({ length: spec.sizes[0] }, (_, i) => 0.3 + 0.4 * i);
    gradientCheck(spec, randomParams(spec.sizes, 11 + n), { x, target });
  });
});

test("softmax sums to one and survives large inputs", () => {
  const p = softmax([900, 901, 899]);
  close(p.reduce((s, v) => s + v, 0), 1);
  assert.ok(p.every(Number.isFinite));
});

test("random parameters are reproducible from a seed", () => {
  assert.deepEqual(randomParams([3, 4, 1], 7), randomParams([3, 4, 1], 7));
  assert.notDeepEqual(randomParams([3, 4, 1], 7), randomParams([3, 4, 1], 8));
});
