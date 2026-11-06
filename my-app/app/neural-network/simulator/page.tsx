import type { Metadata } from "next";
import { Simulator } from "@/components/nn/Simulator";

export const metadata: Metadata = { title: "Simulator" };

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6">
      <h1 className="sr-only">Neural network simulator</h1>
      <Simulator />
    </main>
  );
}
