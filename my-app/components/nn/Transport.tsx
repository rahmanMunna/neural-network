"use client";

import { memo, useMemo } from "react";
import { useProgress } from "./usePlayer";
import type { Clock, PlayerState } from "./usePlayer";

/** The minimum a step needs for the scrubber. Both players satisfy this. */
export interface TransportStep {
  id: string;
  title: string;
  phase: string;
  duration: number;
}

export interface PhaseMeta {
  label: string;
  color: string;
}

function StepProgress({ clock }: { clock: Clock }) {
  const p = useProgress(clock);
  return <span className="absolute inset-y-0 left-0 rounded-[2px] bg-current" style={{ width: `${p * 100}%` }} />;
}

const Scrubber = memo(function Scrubber({
  steps,
  index,
  clock,
  onPick,
  phaseOf,
}: {
  steps: TransportStep[];
  index: number;
  clock: Clock;
  onPick: (i: number) => void;
  phaseOf: (phase: string) => PhaseMeta;
}) {
  const groups = useMemo(() => {
    const out: { phase: string; key: string; items: { step: TransportStep; i: number }[] }[] = [];
    steps.forEach((step, i) => {
      const last = out[out.length - 1];
      if (last && last.phase === step.phase) last.items.push({ step, i });
      else out.push({ phase: step.phase, key: `${step.phase}-${i}`, items: [{ step, i }] });
    });
    return out;
  }, [steps]);

  return (
    <div className="flex min-w-0 flex-1 gap-2">
      {groups.map((g) => {
        const meta = phaseOf(g.phase);
        return (
          <div key={g.key} className="min-w-[38px]" style={{ flex: `${g.items.length} 1 0` }}>
            <div
              className="mb-1 overflow-hidden text-[10.5px] font-medium tracking-wide whitespace-nowrap"
              style={{ color: g.items.some(({ i }) => i === index) ? meta.color : "var(--muted)" }}
            >
              {meta.label}
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
                  style={{ color: meta.color }}
                >
                  <span className="relative h-[5px] w-full overflow-hidden rounded-[2px] bg-[var(--line)] transition-[height] group-hover:h-[9px]">
                    {i < index && <span className="absolute inset-0 bg-current opacity-60" />}
                    {i === index && <StepProgress clock={clock} />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});

const SPEEDS = [0.5, 1, 2];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="currentColor">
      <path d={d} />
    </svg>
  );
}

export function Transport({
  steps,
  player,
  phaseOf,
  finish,
}: {
  steps: TransportStep[];
  player: PlayerState<unknown>;
  phaseOf: (phase: string) => PhaseMeta;
  /** Replaces Next on the last step. */
  finish?: { label: string; onClick: () => void };
}) {
  const { index, playing, speed, clock, atEnd, next, prev, go, replay, togglePlay, setSpeed } = player;
  return (
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
        <Scrubber steps={steps} index={index} clock={clock} onPick={go} phaseOf={phaseOf} />
      </div>
    </div>
  );
}
