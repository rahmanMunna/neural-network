"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { evaluate } from "@/lib/labs/authz";
import type { Action, Role, Scenario } from "@/lib/labs/authz";
import { createLimiter } from "@/lib/labs/ratelimit";
import type { Algorithm, Limiter } from "@/lib/labs/ratelimit";
import { storageAvailable } from "@/lib/sim/engine";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented flex-wrap" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- rate limiting ---------- */

const ALGORITHMS: { value: Algorithm; label: string; note: string }[] = [
  { value: "fixed", label: "Fixed window", note: "Counts per clock window. Watch the boundary: a burst on each side doubles the rate." },
  { value: "sliding", label: "Sliding log", note: "Remembers each request. The limit holds over any span, at the cost of memory." },
  { value: "token", label: "Token bucket", note: "Tokens drip in steadily. Idle time saves up room for a short burst." },
];

interface Dot {
  at: number;
  allowed: boolean;
}

const VIEW_MS = 8_000;

interface LabView {
  now: number;
  level: number;
  dots: Dot[];
  passed: number;
  rejected: number;
}

const EMPTY_VIEW: LabView = { now: 0, level: 0, dots: [], passed: 0, rejected: 0 };

export function RateLimitLab() {
  const [algorithm, setAlgorithm] = useState<Algorithm>("fixed");
  const [limit, setLimit] = useState(5);
  const [windowMs, setWindowMs] = useState(2000);
  const [auto, setAuto] = useState(false);
  const [view, setView] = useState<LabView>(EMPTY_VIEW);
  const limiter = useRef<Limiter | null>(null);
  const dots = useRef<Dot[]>([]);
  const counts = useRef({ passed: 0, rejected: 0 });
  const origin = useRef(0);

  useEffect(() => {
    limiter.current = createLimiter(algorithm, { limit, windowMs });
    dots.current = [];
    counts.current = { passed: 0, rejected: 0 };
    origin.current = performance.now();
  }, [algorithm, limit, windowMs]);

  // The loop owns the moving state and publishes a snapshot for rendering.
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const now = performance.now() - origin.current;
      const from = now - VIEW_MS;
      dots.current = dots.current.filter((d) => d.at >= from);
      setView({
        now,
        level: limiter.current?.level(now) ?? 0,
        dots: dots.current,
        ...counts.current,
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const send = useCallback((n = 1) => {
    if (!limiter.current) return;
    const now = performance.now() - origin.current;
    for (let i = 0; i < n; i++) {
      const at = now + i * 25;
      const allowed = limiter.current.attempt(at);
      dots.current = [...dots.current, { at, allowed }];
      counts.current[allowed ? "passed" : "rejected"]++;
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => send(1), 280);
    return () => clearInterval(id);
  }, [auto, send]);

  const { now, level } = view;
  const from = Math.max(0, now - VIEW_MS);
  const X = (t: number) => ((t - from) / VIEW_MS) * 100;
  const windows: number[] = [];
  if (algorithm === "fixed") {
    for (let t = Math.floor(from / windowMs) * windowMs; t <= now; t += windowMs) windows.push(t);
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Algorithm" value={algorithm} options={ALGORITHMS} onChange={setAlgorithm} />
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-soft)]">
          Limit
          <input type="range" min={1} max={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-24 accent-[var(--signal)]" />
          <span className="stage-num">{limit}</span>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-soft)]">
          per
          <input type="range" min={500} max={5000} step={500} value={windowMs} onChange={(e) => setWindowMs(Number(e.target.value))} className="w-24 accent-[var(--signal)]" />
          <span className="stage-num">{windowMs / 1000}s</span>
        </label>
      </div>
      <p className="mt-2 text-[14px] text-[var(--text-soft)]">{ALGORITHMS.find((a) => a.value === algorithm)!.note}</p>

      <div className="relative mt-3 h-[120px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--stage)]" role="img" aria-label="Timeline of allowed and rejected requests">
        {windows.map((t) => (
          <div key={t} className="absolute inset-y-0 border-l border-dashed border-[var(--line-strong)]" style={{ left: `${X(t)}%` }} />
        ))}
        <div className="absolute inset-x-0 top-1/2 border-t border-[var(--line)]" />
        {view.dots.map((d, i) => (
          <span
            key={`${d.at}-${i}`}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full"
            style={{
              left: `${X(d.at)}%`,
              top: d.allowed ? "30%" : "68%",
              background: d.allowed ? "var(--update)" : "var(--loss)",
            }}
          />
        ))}
        <span className="absolute top-1.5 left-2 text-[11px] text-[var(--update)]">allowed</span>
        <span className="absolute bottom-1.5 left-2 text-[11px] text-[var(--loss)]">429 rejected</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => send(1)}>
          Send one request
        </button>
        <button type="button" className="btn" onClick={() => send(10)}>
          Burst of 10
        </button>
        <button type="button" className="btn" aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
          {auto ? "Stop steady traffic" : "Steady traffic"}
        </button>
        <div className="ml-auto min-w-44 text-[12.5px] text-[var(--text-soft)]">
          <div className="flex justify-between">
            <span>{algorithm === "token" ? "Tokens available" : "Used in window"}</span>
            <span className="stage-num">
              {level.toFixed(algorithm === "token" ? 1 : 0)} / {limit}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--line)]">
            <div className="h-full bg-[var(--signal)]" style={{ width: `${(level / limit) * 100}%` }} />
          </div>
          <div className="stage-num mt-1 text-[var(--muted)]">
            {view.passed} allowed, {view.rejected} rejected
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- erasure coding ---------- */

export function ErasureLab() {
  const [drives, setDrives] = useState(4);
  const [parity, setParity] = useState(2);
  const [dead, setDead] = useState<number[]>([]);
  const safeParity = Math.min(parity, Math.floor(drives / 2));
  const live = dead.filter((d) => d < drives);
  const state = storageAvailable(drives, safeParity, live.length);
  const data = drives - safeParity;

  const toggle = (i: number) => setDead((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
  const summary = !state.read
    ? "Too few shards remain. The object cannot be rebuilt, so reads and writes both fail."
    : !state.write
      ? "Reads still work, because enough shards remain to rebuild the file. New writes are refused until drives return."
      : live.length
        ? "Both reads and writes work. The missing shards are rebuilt from the survivors when the drive returns or is replaced."
        : "Healthy. Each object is split across every drive.";

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-soft)]">
          Drives
          <input type="range" min={4} max={12} value={drives} onChange={(e) => { setDrives(Number(e.target.value)); setDead([]); }} className="w-28 accent-[var(--signal)]" />
          <span className="stage-num">{drives}</span>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-soft)]">
          Parity
          <input type="range" min={1} max={Math.floor(drives / 2)} value={safeParity} onChange={(e) => { setParity(Number(e.target.value)); setDead([]); }} className="w-28 accent-[var(--signal)]" />
          <span className="stage-num">{safeParity}</span>
        </label>
        <span className="stage-num text-[13px] text-[var(--muted)]">
          {data} data + {safeParity} parity, {Math.round((data / drives) * 100)}% usable space
        </span>
      </div>

      <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(74px, 1fr))` }}>
        {Array.from({ length: drives }, (_, i) => {
          const isDead = dead.includes(i);
          const isData = i < data;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={isDead}
              aria-label={`Drive ${i + 1}, ${isDead ? "failed" : "healthy"}. Click to ${isDead ? "restore" : "fail"} it.`}
              onClick={() => toggle(i)}
              className="cursor-pointer rounded-xl border p-2 text-left transition-colors"
              style={{ borderColor: isDead ? "var(--loss)" : "var(--line-strong)", background: "var(--stage)" }}
            >
              <div className="text-[11px] text-[var(--muted)]">drive {i + 1}</div>
              <div className="stage-num mt-1 text-[13px]" style={{ color: isDead ? "var(--loss)" : isData ? "var(--signal)" : "var(--grad)" }}>
                {isDead ? "lost" : isData ? `data ${i + 1}` : `parity ${i - data + 1}`}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[13.5px]">
        {(["read", "write"] as const).map((op) => (
          <span
            key={op}
            className="stage-num rounded-lg border px-2.5 py-1"
            style={{ borderColor: state[op] ? "var(--update)" : "var(--loss)", color: state[op] ? "var(--update)" : "var(--loss)" }}
          >
            {op === "read" ? "GET" : "PUT"} {state[op] ? "200 OK" : "503"}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[15px] text-[var(--text-soft)]" aria-live="polite">
        {summary}
      </p>
      <p className="mt-2 text-[13px] text-[var(--muted)]">
        The 4-drive behaviour here was measured on RustFS 1.0.4. Click drives to fail them. Other layouts follow the same rule: reads need as many shards as there are data shards, and writes need one more when data and parity are equal.
      </p>
    </div>
  );
}

/* ---------- authorization ---------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-[var(--text-soft)]">
      {label}
      {children}
    </div>
  );
}

export function AuthzLab() {
  const [s, setS] = useState<Scenario>({
    authenticated: true,
    role: "editor",
    sameTenant: true,
    isOwner: false,
    status: "draft",
    action: "write",
  });
  const verdict = useMemo(() => evaluate(s), [s]);
  const color = verdict.status === 200 ? "var(--update)" : "var(--loss)";
  const set = <K extends keyof Scenario>(key: K, value: Scenario[K]) => setS((v) => ({ ...v, [key]: value }));
  const yesNo = [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ] as const;

  return (
    <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 md:grid-cols-2">
      <div className="space-y-2.5">
        <Field label="Signed in">
          <Segmented label="Signed in" value={s.authenticated ? "yes" : "no"} options={[...yesNo]} onChange={(v) => set("authenticated", v === "yes")} />
        </Field>
        <Field label="Role">
          <Segmented<Role> label="Role" value={s.role} options={[{ value: "viewer", label: "Viewer" }, { value: "editor", label: "Editor" }, { value: "admin", label: "Admin" }]} onChange={(v) => set("role", v)} />
        </Field>
        <Field label="Same tenant as the document">
          <Segmented label="Same tenant" value={s.sameTenant ? "yes" : "no"} options={[...yesNo]} onChange={(v) => set("sameTenant", v === "yes")} />
        </Field>
        <Field label="Owns the document">
          <Segmented label="Owner" value={s.isOwner ? "yes" : "no"} options={[...yesNo]} onChange={(v) => set("isOwner", v === "yes")} />
        </Field>
        <Field label="Document status">
          <Segmented<Scenario["status"]> label="Status" value={s.status} options={[{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }]} onChange={(v) => set("status", v)} />
        </Field>
        <Field label="Action">
          <Segmented<Action> label="Action" value={s.action} options={[{ value: "read", label: "Read" }, { value: "write", label: "Write" }, { value: "delete", label: "Delete" }]} onChange={(v) => set("action", v)} />
        </Field>
      </div>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--stage)] p-4">
        <div className="stage-num text-[30px]" style={{ color }}>
          {verdict.status}
        </div>
        <p className="mt-1 text-[14.5px] text-[var(--text-soft)]" aria-live="polite">
          {verdict.reason}
        </p>
        <ol className="mt-3 space-y-1.5 text-[13.5px]">
          {verdict.checks.map((c) => (
            <li key={c.label} className="flex gap-2" style={{ color: c.passed ? "var(--update)" : "var(--loss)" }}>
              <span className="stage-num">{c.passed ? "pass" : "fail"}</span>
              <span className="text-[var(--text-soft)]">{c.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
