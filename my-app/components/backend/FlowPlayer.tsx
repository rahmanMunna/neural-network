"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Transport } from "@/components/nn/Transport";
import { usePlayer } from "@/components/nn/usePlayer";
import { compileScenario, TONE_COLOR, TONE_LABEL } from "@/lib/backend/flow";
import type { CompiledScenario, FlowSpec, Tone } from "@/lib/backend/flow";
import { CodeBlock, Rich } from "./Code";
import { FlowStage } from "./FlowStage";

export type SnippetView = { code: string; lang: string; file: string };

function ScenarioPlayer({
  spec,
  scenario,
  snippets,
}: {
  spec: FlowSpec;
  scenario: CompiledScenario;
  snippets: Record<string, SnippetView>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const player = usePlayer(scenario.steps);
  const { index, step, clock, next, prev, togglePlay } = player;
  const phaseOf = useCallback(
    (p: string) => scenario.phases[p] ?? { label: p, color: "var(--muted)" },
    [scenario.phases],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea, [contenteditable]")) return;
      // Only the player on screen answers, so the page keeps normal keys elsewhere.
      const rect = box.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 120 || rect.top > window.innerHeight - 120) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === " " && !el.closest("button")) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, togglePlay]);

  const color = phaseOf(step.phase).color;
  const snippet = step.code ? snippets[step.code] : undefined;
  const tones = useMemo(() => {
    const used = new Set<Tone>();
    scenario.steps.forEach((s) => s.hops.forEach((h) => used.add(h.tone)));
    return [...used];
  }, [scenario.steps]);

  return (
    <div ref={box} className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--stage)]">
        <div className="flex h-10 items-center gap-3 border-b border-[var(--line)] px-4 text-[12.5px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate font-medium" style={{ color }}>
            {step.phase}
          </span>
          <span className="ml-auto hidden items-center gap-3 text-[11.5px] text-[var(--muted)] md:flex">
            {tones.map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[t] }} />
                {TONE_LABEL[t]}
              </span>
            ))}
          </span>
          <span className="stage-num ml-auto text-[var(--muted)] md:ml-3">
            {index + 1} / {scenario.steps.length}
          </span>
        </div>
        <div className="relative h-[clamp(380px,56dvh,560px)]">
          <FlowStage nodes={spec.nodes} scenario={scenario} step={step} clock={clock} label={scenario.label} />
        </div>
      </div>

      <Transport steps={scenario.steps} player={player} phaseOf={phaseOf} />

      <div className="min-h-[150px] rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-5 py-4">
        <div key={step.id} className="narration grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div>
            <h3 className="font-display text-[23px] leading-tight text-[var(--text)]">{step.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--text-soft)]">
              <Rich text={step.body} />
            </p>
          </div>
          <div className="min-w-0 space-y-2.5">
            {snippet && <CodeBlock code={snippet.code} lang={snippet.lang} file={snippet.file} compact />}
            {step.note && (
              <p className="border-l-2 border-[var(--line-strong)] pl-3 text-[14px] leading-relaxed text-[var(--text-soft)]">
                <Rich text={step.note} />
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowPlayer({ spec, snippets }: { spec: FlowSpec; snippets: Record<string, SnippetView> }) {
  const compiled = useMemo(() => spec.scenarios.map((s) => compileScenario(spec, s)), [spec]);
  const [active, setActive] = useState(0);
  const scenario = compiled[active]!;

  return (
    <div className="flex flex-col gap-3">
      {compiled.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Scenarios">
          {compiled.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[13.5px] transition-colors ${
                i === active
                  ? "border-[var(--line-strong)] bg-[var(--raised)] text-[var(--text)]"
                  : "border-[var(--line)] text-[var(--text-soft)] hover:text-[var(--text)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-[15px] leading-relaxed text-[var(--text-soft)]">
        <Rich text={scenario.summary} />
      </p>
      <ScenarioPlayer key={scenario.id} spec={spec} scenario={scenario} snippets={snippets} />
    </div>
  );
}
