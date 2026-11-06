"use client";

import { memo, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Prose, Tex } from "@/components/Math";
import type { NetSpec } from "@/lib/nn/engine";
import type { StageLayout } from "@/lib/nn/layout";
import { PHASE_LABEL } from "@/lib/nn/timeline";
import type { Phase, Step } from "@/lib/nn/timeline";
import { Stage } from "./Stage";
import { useProgress, usePlayer } from "./usePlayer";
import type { Clock } from "./usePlayer";

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

/* ---------- the row of ticks ---------- */

function StepProgress({ clock }: { clock: Clock }) {
  const p = useProgress(clock);
  return <span className="absolute inset-y-0 left-0 rounded-[2px] bg-current" style={{ width: `${p * 100}%` }} />;
}

const Scrubber = memo(function Scrubber({
  steps,
  index,
  clock,
  onPick,
}: {
  steps: Step[];
  index: number;
  clock: Clock;
  onPick: (i: number) => void;
}) {
  const groups = useMemo(() => {
    const out: { phase: Phase; items: { step: Step; i: number }[] }[] = [];
    steps.forEach((step, i) => {
      const last = out[out.length - 1];
      if (last && last.phase === step.phase) last.items.push({ step, i });
      else out.push({ phase: step.phase, items: [{ step, i }] });
    });
    return out;
  }, [steps]);

  return (
    <div className="flex min-w-0 flex-1 gap-2">
      {groups.map((g) => (
        <div key={g.phase} className="min-w-[38px]" style={{ flex: `${g.items.length} 1 0` }}>
          <div
            className="mb-1 overflow-hidden text-[10.5px] font-medium tracking-wide whitespace-nowrap"
            style={{ color: g.items.some(({ i }) => i === index) ? PHASE_COLOR[g.phase] : "var(--muted)" }}
          >
            {PHASE_LABEL[g.phase]}
          </div>
          <div className="flex gap-[2px]">
            {g.items.map(({ step, i }) => (
              <button
                key={step.id}
                type="button"
                title={step.title}
                aria-label={`Step ${i + 1}: ${step.title}`}
                aria-current={i === index ? "step" : undefined}
                onClick={() => onPick(i)}
                className="group flex h-6 min-w-0 flex-1 cursor-pointer items-center"
                style={{ color: PHASE_COLOR[g.phase] }}
              >
                <span className="relative h-[5px] w-full overflow-hidden rounded-[2px] bg-[var(--line)] transition-[height] group-hover:h-[9px]">
                  {i < index && <span className="absolute inset-0 bg-current opacity-60" />}
                  {i === index && <StepProgress clock={clock} />}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

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

/* ---------- transport ---------- */

const SPEEDS = [0.5, 1, 2];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="currentColor">
      <path d={d} />
    </svg>
  );
}

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
  const { index, step, playing, speed, clock, atEnd, next, prev, go, replay, togglePlay, setSpeed } = player;

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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn" onClick={prev} disabled={index === 0}>
            <Icon d="M10.5 2.5 4.5 8l6 5.5z" />
            Prev
          </button>
          {finish && atEnd ? (
            <button type="button" className="btn btn-primary" onClick={finish.onClick}>
              {finish.label}
              <Icon d="M5.5 2.5 11.5 8l-6 5.5z" />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={next} disabled={atEnd}>
              Next
              <Icon d="M5.5 2.5 11.5 8l-6 5.5z" />
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={replay} title="Replay this step" aria-label="Replay this step">
            <Icon d="M8 3a5 5 0 1 1-4.6 3H1.8l2.4-3 2.4 3H5A3.4 3.4 0 1 0 8 4.6z" />
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={togglePlay}
            aria-pressed={playing}
            title="Move through the steps on its own"
          >
            <Icon d={playing ? "M4 3h3v10H4zM9 3h3v10H9z" : "M4 2.5 13 8l-9 5.5z"} />
            {playing ? "Pause" : "Auto"}
          </button>
          <div className="ml-1 flex rounded-lg border border-[var(--line)] p-0.5" role="group" aria-label="Animation speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === speed}
                onClick={() => setSpeed(s)}
                className={`stage-num cursor-pointer rounded-md px-2 py-1 text-[12px] ${
                  s === speed ? "bg-[var(--raised)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-[280px] flex-1">
          <Scrubber steps={steps} index={index} clock={clock} onPick={go} />
        </div>
      </div>

      <div className="min-h-[172px] rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-5 py-4">
        <Narration step={step} />
      </div>
    </div>
  );
}
