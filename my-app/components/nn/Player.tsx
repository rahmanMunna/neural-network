"use client";

import { memo, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { Prose, Tex } from "@/components/Math";
import type { NetSpec } from "@/lib/nn/engine";
import type { StageLayout } from "@/lib/nn/layout";
import { PHASE_LABEL } from "@/lib/nn/timeline";
import type { Phase, Step } from "@/lib/nn/timeline";
import { Stage } from "./Stage";
import { Transport } from "./Transport";
import { usePlayer } from "./usePlayer";

const PHASE_COLOR: Record<Phase, string> = {
  setup: "var(--muted)",
  forward: "var(--signal)",
  loss: "var(--loss)",
  backward: "var(--grad)",
  update: "var(--update)",
  verify: "var(--signal)",
};

/* ---------- direction of travel ---------- */

function FlowHint({ phase }: { phase: Phase }) {
  const dir = phase === "backward" ? "back" : phase === "forward" || phase === "verify" ? "fwd" : null;
  if (!dir) return null;
  return (
    <span className="flow-hint" data-dir={dir} aria-hidden style={{ color: PHASE_COLOR[phase] }}>
      <i />
      <i />
      <i />
    </span>
  );
}

/* ---------- narration ---------- */

const Narration = memo(function Narration({ step }: { step: Step }) {
  return (
    <div key={step.id} className="narration grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div>
        <h2 className="font-display text-[23px] leading-tight text-[var(--text)]">{step.title}</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--text-soft)]">
          <Prose text={step.body} />
        </p>
      </div>
      <div className="min-w-0">
        {step.math.length > 0 && (
          <div className="math-panel space-y-2 overflow-x-auto pb-1 text-[15px]">
            {step.math.map((m) => (
              <div key={m} className="w-max min-w-full">
                <Tex display>{m}</Tex>
              </div>
            ))}
          </div>
        )}
        {step.note && (
          <p className="mt-2.5 border-l-2 border-[var(--line-strong)] pl-3 text-[14px] leading-relaxed text-[var(--text-soft)]">
            <Prose text={step.note} />
          </p>
        )}
      </div>
    </div>
  );
});

export interface PlayerProps {
  steps: Step[];
  spec: NetSpec;
  target: number[];
  inputNames?: string[];
  uid: string;
  label: string;
  /** Replaces Next on the last step. */
  finish?: { label: string; onClick: () => void };
  autoPlay?: boolean;
  bottomPad?: number;
  overlay?: (layout: StageLayout, scale: number) => ReactNode;
  statusRight?: ReactNode;
  /** Jump to the first step of the phase named in the URL hash. */
  readHash?: boolean;
  /** Height used by anything above the player, so the stage can make room. */
  aboveHeight?: number;
}

export function Player({
  steps,
  spec,
  target,
  inputNames,
  uid,
  label,
  finish,
  autoPlay,
  bottomPad,
  overlay,
  statusRight,
  readHash,
  aboveHeight = 0,
}: PlayerProps) {
  const player = usePlayer(steps, { autoPlay, onFinish: finish?.onClick });
  const { index, step, clock, next, prev, go, togglePlay } = player;
  const phaseOf = useCallback((p: string) => ({ label: PHASE_LABEL[p as Phase], color: PHASE_COLOR[p as Phase] }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea")) return;
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

  useEffect(() => {
    if (!readHash) return;
    const jump = () => {
      const hash = window.location.hash.slice(1);
      const at = steps.findIndex((s) => s.phase === hash);
      if (at >= 0) go(at);
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, [readHash, steps, go]);

  const color = PHASE_COLOR[step.phase];

  return (
    <div className="flex flex-col gap-3">
      <div className="stage-frame overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--stage)]">
        <div className="flex h-10 items-center gap-3 border-b border-[var(--line)] px-4 text-[12.5px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="font-medium" style={{ color }}>
            {PHASE_LABEL[step.phase]}
          </span>
          <FlowHint phase={step.phase} />
          <span className="ml-auto flex items-center gap-4 text-[var(--muted)]">
            {statusRight}
            <span className="stage-num">
              {index + 1} / {steps.length}
            </span>
          </span>
        </div>
        <div className="relative" style={{ height: `clamp(400px, calc(100dvh - ${372 + aboveHeight}px), 760px)` }}>
          <Stage
            spec={spec}
            step={step}
            clock={clock}
            target={target}
            inputNames={inputNames}
            uid={uid}
            bottomPad={bottomPad}
            overlay={overlay}
            label={`${label}. Current step: ${step.title}`}
          />
        </div>
      </div>

      <Transport steps={steps} player={player} phaseOf={phaseOf} finish={finish} />

      <div className="min-h-[172px] rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-5 py-4">
        <Narration step={step} />
      </div>
    </div>
  );
}
