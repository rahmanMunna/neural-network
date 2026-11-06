"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * Progress lives outside React state so a running animation re-renders only
 * the moving layer of the stage, not the whole page.
 */
export class Clock {
  progress = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  get = () => this.progress;
  set(p: number) {
    this.progress = p;
    this.listeners.forEach((fn) => fn());
  }
}

export function useProgress(clock: Clock) {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/** True once the current step has played out. Changes at most twice a step. */
export function useSettled(clock: Clock) {
  const read = () => clock.progress >= 1;
  return useSyncExternalStore(clock.subscribe, read, read);
}

const HOLD_MS = 650;

export interface PlayerState<S = { duration: number }> {
  index: number;
  step: S;
  playing: boolean;
  speed: number;
  clock: Clock;
  atEnd: boolean;
  next: () => void;
  prev: () => void;
  go: (i: number) => void;
  replay: () => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
}

export function usePlayer<S extends { duration: number }>(
  steps: S[],
  opts?: { autoPlay?: boolean; onFinish?: () => void },
): PlayerState<S> {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(opts?.autoPlay ?? false);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0);
  const clock = useMemo(() => new Clock(), []);
  const onFinish = opts?.onFinish;

  const safeIndex = Math.min(index, steps.length - 1);
  const atEnd = safeIndex === steps.length - 1;

  const go = useCallback(
    (i: number) => {
      setIndex(Math.max(0, Math.min(steps.length - 1, i)));
      setRun((r) => r + 1);
    },
    [steps.length],
  );
  const next = useCallback(() => {
    if (safeIndex < steps.length - 1) go(safeIndex + 1);
    else {
      setPlaying(false);
      onFinish?.();
    }
  }, [go, onFinish, safeIndex, steps.length]);
  const prev = useCallback(() => go(safeIndex - 1), [go, safeIndex]);
  const replay = useCallback(() => setRun((r) => r + 1), []);
  const togglePlay = useCallback(() => {
    setPlaying((v) => {
      if (!v && clock.progress >= 1 && atEnd) setRun((r) => r + 1);
      return !v;
    });
  }, [atEnd, clock]);

  const step = steps[safeIndex]!;

  // A new step, or a replay, rewinds. Changing speed or auto-play must not.
  useEffect(() => {
    clock.set(0);
  }, [clock, step, run]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let last = performance.now();
    let p = clock.progress;

    const finished = () => {
      if (playing) holdTimer = setTimeout(next, reduced ? 2600 : HOLD_MS / speed);
    };

    if (reduced || p >= 1) {
      clock.set(1);
      finished();
    } else {
      const tick = (now: number) => {
        // Cap the delta so returning to a background tab does not skip the step.
        const dt = Math.min(now - last, 50);
        last = now;
        p = Math.min(1, p + (dt * speed) / step.duration);
        clock.set(p);
        if (p < 1) frame = requestAnimationFrame(tick);
        else finished();
      };
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [clock, step, run, speed, playing, next]);

  return { index: safeIndex, step, playing, speed, clock, atEnd, next, prev, go, replay, togglePlay, setSpeed };
}
