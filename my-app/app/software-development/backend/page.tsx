import type { Metadata } from "next";
import Link from "next/link";
import { BACKEND_BASE, BACKEND_NAV } from "@/lib/backend/nav";
import { TOPICS } from "@/lib/backend/topics";

export const metadata: Metadata = {
  title: "Backend Technologies",
  description: "How backends work: concepts, animated walkthroughs, tested code and simulations.",
};

const PATH = [
  ["Learn", "What it is, why it exists, and when not to use it."],
  ["See it work", "Animated walkthroughs you control step by step."],
  ["Build it", "Tested code, explained line by line, with how to add it to your project."],
  ["Simulate", "Change the settings, break things, and watch what happens."],
];

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[920px] px-5 py-10 sm:px-8 lg:py-14">
      <h1 className="font-display text-[44px] leading-[1.08] sm:text-[56px]">Backend Technologies</h1>
      <p className="mt-4 max-w-[62ch] text-[18px] leading-relaxed text-[var(--text-soft)]">
        How a request really travels through a modern backend, and why each piece is there. Start with Client-Server for the
        whole picture, then go deeper into any part of it.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`${BACKEND_BASE}/client-server`} className="btn btn-primary">
          Start with Client-Server
        </Link>
        <Link href={`${BACKEND_BASE}/simulator`} className="btn" style={{ height: 40 }}>
          Open the System Simulator
        </Link>
      </div>

      <section className="mt-12">
        <h2 className="font-display text-[30px]">How each topic works</h2>
        <ol className="mt-3 grid gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          {PATH.map(([title, text], i) => (
            <li key={title} className="bg-[var(--panel)] px-4 py-3">
              <div className="font-medium text-[var(--text)]">
                <span className="stage-num mr-2 text-[var(--signal)]">{i + 1}</span>
                {title}
              </div>
              <p className="mt-0.5 text-[14.5px] text-[var(--text-soft)]">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {BACKEND_NAV.map((group) => (
        <section key={group.group} className="mt-11">
          <h2 className="font-display text-[30px]">{group.group}</h2>
          <ul className="mt-2 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {group.items.map((item) => {
              const topic = TOPICS.find((t) => t.slug === item.slug)!;
              return (
                <li key={item.slug}>
                  <Link href={`${BACKEND_BASE}/${item.slug}`} className="group block py-3.5">
                    <span className="font-medium text-[var(--text)] group-hover:text-[var(--signal)]">{topic.title}</span>
                    <span className="mt-0.5 block text-[15px] leading-relaxed text-[var(--text-soft)]">{topic.lede}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
