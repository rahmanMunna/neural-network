import type { Metadata } from "next";
import Link from "next/link";
import { Tex } from "@/components/Math";
import { ParameterMap } from "@/components/nn/ParameterMap";

export const metadata: Metadata = { title: "Neural Networks" };

const PARTS = [
  { hash: "forward", color: "var(--signal)", title: "Forward pass", text: "Values flow left to right. Each neuron multiplies, adds and squashes." },
  { hash: "loss", color: "var(--loss)", title: "Loss", text: "One number measures how far the prediction is from the truth." },
  { hash: "backward", color: "var(--grad)", title: "Backpropagation", text: "The error flows right to left. The chain rule finds each weight's share of the blame." },
  { hash: "update", color: "var(--update)", title: "Gradient descent", text: "Every weight takes a small step in the direction that lowers the loss." },
  { hash: "verify", color: "var(--signal)", title: "Check", text: "The same example goes through again, and the loss comes out smaller." },
];

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-5 py-10 sm:px-8 lg:py-14">
      <h1 className="font-display text-[44px] leading-[1.08] sm:text-[56px]">How a neural network learns</h1>
      <p className="mt-4 max-w-[62ch] text-[18px] leading-relaxed text-[var(--text-soft)]">
        A neural network is a stack of small calculations. Training it means adjusting those calculations until the
        answers improve. On this page you meet one tiny network. In the walkthrough you watch it learn, one neuron at a
        time, with every number visible.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/neural-network/walkthrough" className="btn btn-primary">
          Start the walkthrough
        </Link>
        <Link href="/neural-network/simulator" className="btn" style={{ height: 40 }}>
          Open the simulator
        </Link>
      </div>

      <section className="mt-14">
        <h2 className="font-display text-[30px]">The problem</h2>
        <p className="mt-2 max-w-[62ch] text-[16px] leading-relaxed text-[var(--text-soft)]">
          We want to predict whether a patient has a particular disease. This is binary classification: the answer is yes
          or no, and the network gives a probability between 0 and 1. Our example is one patient, with three normalized
          features, who does have the disease.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
          {[
            ["Age", "x₁", "1.0"],
            ["BMI", "x₂", "0.5"],
            ["Blood glucose", "x₃", "1.5"],
            ["Disease", "y", "1"],
          ].map(([label, sym, value]) => (
            <div key={label} className="bg-[var(--panel)] px-4 py-3">
              <dt className="text-[13px] text-[var(--muted)]">
                {label} <span className="stage-num">{sym}</span>
              </dt>
              <dd className="stage-num mt-1 text-[24px]" style={{ color: sym === "y" ? "var(--update)" : "var(--signal)" }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-[30px]">The 21 numbers that get trained</h2>
        <p className="mt-2 max-w-[62ch] text-[16px] leading-relaxed text-[var(--text-soft)]">
          The network has 3 inputs, 4 hidden neurons and 1 output. Its knowledge lives in 16 weights, one on each line, and
          5 biases, one in each neuron that computes. Hover a number in the tables to find it in the network.
        </p>
        <ParameterMap />
      </section>

      <section className="mt-14">
        <h2 className="font-display text-[30px]">What each neuron does</h2>
        <p className="mt-2 max-w-[62ch] text-[16px] leading-relaxed text-[var(--text-soft)]">
          Every neuron runs the same two lines, with different numbers. It adds up its inputs, each scaled by a weight, plus
          its bias. Then it passes the total through an activation function.
        </p>
        <div className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-5 py-4 sm:grid-cols-2">
          <Tex display>{"z = w_1 x_1 + w_2 x_2 + w_3 x_3 + b"}</Tex>
          <Tex display>{"a = \\sigma(z) = \\dfrac{1}{1 + e^{-z}}"}</Tex>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-[30px]">One training iteration</h2>
        <p className="mt-2 max-w-[62ch] text-[16px] leading-relaxed text-[var(--text-soft)]">
          The walkthrough moves through five stages. The colours mean the same thing everywhere on this site.
        </p>
        <ol className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {PARTS.map((part, i) => (
            <li key={part.hash}>
              <Link href={`/neural-network/walkthrough#${part.hash}`} className="group flex items-baseline gap-4 py-3.5">
                <span className="stage-num w-5 text-[13px] text-[var(--muted)]">{i + 1}</span>
                <span className="w-44 shrink-0 font-medium" style={{ color: part.color }}>
                  {part.title}
                </span>
                <span className="text-[15px] text-[var(--text-soft)] group-hover:text-[var(--text)]">{part.text}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
