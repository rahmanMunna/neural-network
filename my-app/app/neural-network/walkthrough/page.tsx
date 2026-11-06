import type { Metadata } from "next";
import { Walkthrough } from "@/components/nn/Walkthrough";

export const metadata: Metadata = { title: "Walkthrough" };

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6">
      <h1 className="sr-only">One training iteration, step by step</h1>
      <Walkthrough />
    </main>
  );
}
