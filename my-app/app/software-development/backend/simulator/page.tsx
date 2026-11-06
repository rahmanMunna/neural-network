import type { Metadata } from "next";
import { SystemDesigner } from "@/components/backend/SystemDesigner";

export const metadata: Metadata = {
  title: "System Simulator",
  description: "Design a backend from real components, send traffic through it, and break it safely.",
};

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6">
      <h1 className="font-display text-[34px] leading-tight">System Simulator</h1>
      <p className="mt-1 mb-4 max-w-[80ch] text-[15.5px] leading-relaxed text-[var(--text-soft)]">
        Place components, connect them and send traffic through your design. This is a real simulation: queues, cache hit
        rates and timeouts come from how the parts behave together, and nothing is scripted. Numbers are illustrative, so use
        it to understand behaviour, not to predict production capacity.
      </p>
      <SystemDesigner />
    </main>
  );
}
