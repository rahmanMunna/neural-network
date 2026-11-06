import assert from "node:assert/strict";
import { test } from "node:test";
import { randomParams, run } from "./engine.ts";
import type { HiddenActivation, LossName, NetSpec, OutputActivation } from "./engine.ts";
import { exampleParams, exampleSample, exampleSpec } from "./example.ts";
import { buildTimeline, eid, nid } from "./timeline.ts";
import type { Detail, Port, Step } from "./timeline.ts";

const tasks: Array<[OutputActivation, LossName, (k: number) => number[]]> = [
  ["sigmoid", "bce", () => [1]],
  ["sigmoid", "mse", () => [0]],
  ["softmax", "cce", (k) => Array.from({ length: k }, (_, i) => (i === 1 ? 1 : 0))],
  ["softmax", "mse", (k) => Array.from({ length: k }, (_, i) => (i === 0 ? 1 : 0))],
  ["linear", "mse", () => [0.7]],
];
const shapes = [[], [4], [1], [8, 3], [5, 5, 5, 5]];
const activations: HiddenActivation[] = ["sigmoid", "tanh", "relu", "leakyRelu"];
const details: Detail[] = ["neuron", "layer"];

function checkStep(step: Step, spec: NetSpec) {
  const { sizes } = spec;
  const validNeuron = (l: number, j: number) => l >= 0 && l < sizes.length && j >= 0 && j < sizes[l];
  const rows = new Set(
    [...(step.scene.card?.left?.rows ?? []), ...(step.scene.card?.right?.rows ?? [])].map((r) => r.id),
  );
  const checkPort = (p: Port) => {
    if (p.kind === "neuron") assert.ok(validNeuron(p.l, p.j), `${step.id}: bad neuron ${p.l}:${p.j}`);
    if (p.kind === "row") assert.ok(rows.has(p.id), `${step.id}: pulse targets missing row ${p.id}`);
  };
  for (const pulse of step.scene.pulses) {
    checkPort(pulse.from);
    checkPort(pulse.to);
    assert.ok(pulse.window[0] <= pulse.window[1] && pulse.window[1] <= 1.0001, `${step.id}: bad window`);
    if (pulse.edge) {
      const [l, j, i] = pulse.edge;
      assert.ok(validNeuron(l, j) && validNeuron(l - 1, i), `${step.id}: bad edge`);
    }
  }
  assert.ok(step.duration > 0);
  for (const m of step.math) assert.ok(!/NaN|undefined/.test(m), `${step.id}: ${m}`);
  assert.ok(!/NaN|undefined/.test(step.title + step.body));
}

test("every configuration compiles to a valid timeline", () => {
  let count = 0;
  for (const [outputActivation, loss, target] of tasks) {
    for (const hidden of shapes) {
      for (const hiddenActivation of activations) {
        for (const detail of details) {
          const outputs = outputActivation === "softmax" ? 4 : 1;
          const sizes = [3, ...hidden, outputs];
          const spec: NetSpec = { sizes, hiddenActivation, outputActivation, loss, learningRate: 0.1 };
          const sample = { x: [1, 0.5, 1.5], target: target(outputs) };
          const params = randomParams(sizes, 3 + count);
          const t = buildTimeline({ spec, params, sample, detail });
          t.steps.forEach((s) => checkStep(s, spec));
          assert.equal(new Set(t.steps.map((s) => s.id)).size, t.steps.length, "duplicate step id");
          count++;
        }
      }
    }
  }
  assert.equal(count, 200);
});

test("the last step shows exactly the state the engine computes", () => {
  const t = buildTimeline({ spec: exampleSpec, params: exampleParams, sample: exampleSample, detail: "neuron" });
  const last = t.steps[t.steps.length - 1].after;
  assert.deepEqual(last.w, t.nextParams.w);
  assert.deepEqual(last.b, t.nextParams.b);
  assert.deepEqual(last.a, t.nextTrace.a);
  assert.equal(last.loss, t.nextTrace.loss);
});

test("every parameter is updated exactly once, in both detail levels", () => {
  for (const detail of details) {
    const t = buildTimeline({ spec: exampleSpec, params: exampleParams, sample: exampleSample, detail });
    const updates = t.steps.filter((s) => s.phase === "update");
    const moved = updates.flatMap((s) => s.scene.edgeMorphs.map((m) => eid(m.l, m.j, m.i)));
    assert.equal(moved.length, 16);
    assert.equal(new Set(moved).size, 16);
  }
});

test("snapshots never change a step that came before them", () => {
  const t = buildTimeline({ spec: exampleSpec, params: exampleParams, sample: exampleSample, detail: "neuron" });
  const first = t.steps[0].before;
  assert.ok(first.a.every((layer) => layer.every((v) => v === null)));
  assert.equal(first.loss, null);
  assert.deepEqual(first.w, exampleParams.w);
});

test("the chain step product equals the gradient when there is one path", () => {
  const t = buildTimeline({ spec: exampleSpec, params: exampleParams, sample: exampleSample, detail: "neuron" });
  const chain = t.steps.find((s) => s.id === "chain")!;
  assert.ok(Math.abs(chain.scene.chain!.product - t.trace.gradW[1][0][0]) < 1e-12);
  assert.ok(chain.scene.focus!.neurons.includes(nid(1, 0)));
});

test("a learning rate that overshoots is reported honestly", () => {
  const spec: NetSpec = {
    sizes: [1, 1],
    hiddenActivation: "sigmoid",
    outputActivation: "linear",
    loss: "mse",
    learningRate: 5,
  };
  const sample = { x: [1], target: [1] };
  const params = { w: [[], [[0]]], b: [[], [0]] };
  const t = buildTimeline({ spec, params, sample, detail: "neuron" });
  assert.ok(t.nextTrace.loss > run(spec, params, sample).loss, "this configuration should overshoot");
  assert.equal(t.steps[t.steps.length - 1].title, "The loss went up");
});
