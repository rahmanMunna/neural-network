"use client";

import { useMemo } from "react";
import Link from "next/link";
import { exampleInputNames, exampleParams, exampleSample, exampleSpec } from "@/lib/nn/example";
import { buildTimeline } from "@/lib/nn/timeline";
import type { StepCopy } from "@/lib/nn/timeline";
import { Player } from "./Player";

/** Teaching notes for the worked example, on top of the generated narration. */
const COPY: Record<string, StepCopy> = {
  setup: {
    title: "A 3–4–1 network, before it has seen anything",
    body: "Three inputs, four hidden neurons, one output: 21 trainable parameters, all set by hand for this example. Blue lines are positive weights, pink lines are negative, and thicker means larger. Press Next to send one patient through.",
  },
  input: {
    title: "One patient enters the network",
    body: "Age, BMI and blood glucose, already normalized. The input layer does no math. It holds these three values and passes them along. The true label is $y = 1$: this patient has the disease.",
  },
  "fwd:1:0": {
    body: "Watch the three inputs travel to the first hidden neuron. Each signal is scaled by the weight on its line, then the neuron adds the three results and its bias to get $z$. Sigmoid then squeezes $z$ into a value between 0 and 1.",
    note: "Sigmoid gives the network its curve. Without a non-linear step like this, stacking layers would add nothing: the whole network would collapse into one straight-line equation.",
  },
  "fwd:1:1": {
    note: "Here the weighted sum is exactly 0, and sigmoid of 0 is 0.5: the middle of the curve. Every hidden neuron sees the same inputs but has its own weights, which is why each one ends up with a different opinion.",
  },
  "fwd:2:0": {
    title: "The output neuron makes a prediction",
    body: "The four hidden outputs now play the role of inputs. Same recipe: weighted sum, bias, sigmoid. The result is the network's probability of disease.",
    note: "0.53484 is above the 0.5 threshold, so this counts as class 1. The answer is correct, but the network is barely more confident than a coin flip.",
  },
  loss: {
    title: "How wrong was it?",
    body: "Binary cross-entropy is the right measure for a yes-or-no problem. Because the true label is 1, the second term vanishes and only $-\\log(\\hat y)$ remains. The curve shows why: the loss falls toward 0 as the prediction approaches 1.",
  },
  "bwd:2:0": {
    title: "Backpropagation starts at the output",
    note: "The result is negative, so increasing the output's $z$ would lower the loss. Each output weight's gradient is this value times the signal that came through that weight: the larger the signal, the more that weight is responsible.",
  },
  "bwd:1:0": {
    title: "How much did h₁ contribute to the error?",
    body: "The gradient travels back through the weight that joins this neuron to the output, then through the neuron's own sigmoid. Each part of that journey multiplies in one more slope. From the result, the gradient of each incoming weight is just $\\delta$ times the input on that line.",
    note: "Why $a(1-a)$? It is the derivative of sigmoid. For h₁ that is 0.53743 × 0.46257.",
  },
  "bwd:1:1": {
    note: "Look at the sign. This neuron's weight to the output is negative, so its gradient comes out positive, and its weights will move the other way from h₁. Lines glowing brighter have larger gradients.",
  },
  chain: {
    title: "The chain rule, on the wire",
    body: "This is the whole idea of backpropagation in one picture. To get the gradient of $w^{(1)}_{11}$, walk from the loss back to that weight and multiply each slope you pass. The result matches the number the neuron already computed.",
  },
  "upd:2:0": {
    title: "Gradient descent updates the output weights",
    body: "All four output weights have negative gradients, so all four increase. The largest gradient belongs to the line from h₄, and that weight moves the most. The learning rate of 0.1 keeps every step small.",
  },
  "upd:1:0": {
    body: "The input-to-hidden weights use the same equation. Their gradients are smaller than the output layer's because each extra link in the chain multiplied them by a slope of at most 0.25.",
  },
  reforward: {
    title: "Run the same patient through again",
  },
  compare: {
    title: "The loss dropped by 7.66%",
    body: "One update moved the prediction from 0.53484 to 0.56110 and the loss from 0.62579 to 0.57786. That is one training iteration. Real training repeats it thousands of times over many patients.",
  },
};

export function Walkthrough() {
  const timeline = useMemo(
    () =>
      buildTimeline({
        spec: exampleSpec,
        params: exampleParams,
        sample: exampleSample,
        detail: "neuron",
        digits: 5,
        inputNames: exampleInputNames,
        copy: COPY,
        intro: true,
      }),
    [],
  );

  return (
    <>
      <Player
        steps={timeline.steps}
        spec={exampleSpec}
        target={exampleSample.target}
        inputNames={exampleInputNames}
        uid="walk"
        label="Animated 3-4-1 neural network"
        readHash
      />
      <p className="mt-4 text-[14px] text-[var(--muted)]">
        Keyboard: <kbd>←</kbd> <kbd>→</kbd> move between steps, <kbd>Space</kbd> toggles auto. Hover any line or neuron for
        its current values. Ready to change the network?{" "}
        <Link href="/neural-network/simulator" className="text-[var(--signal)] underline underline-offset-3">
          Open the simulator
        </Link>
        .
      </p>
    </>
  );
}
