import type { NetSpec, Params, Sample } from "./engine.ts";

/** The worked example: one patient, a 3-4-1 network, one training iteration. */
export const exampleSpec: NetSpec = {
  sizes: [3, 4, 1],
  hiddenActivation: "sigmoid",
  outputActivation: "sigmoid",
  loss: "bce",
  learningRate: 0.1,
};

export const exampleParams: Params = {
  w: [
    [],
    [
      [0.1, 0.2, -0.1],
      [-0.2, 0.1, 0.1],
      [0.1, -0.1, 0.2],
      [0.2, 0.1, 0.1],
    ],
    [[0.3, -0.2, 0.1, 0.2]],
  ],
  b: [[], [0.1, 0, -0.1, 0.05], [-0.1]],
};

export const exampleSample: Sample = { x: [1, 0.5, 1.5], target: [1] };

export const exampleInputNames = ["Age", "BMI", "Blood glucose"];
