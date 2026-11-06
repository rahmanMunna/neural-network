/**
 * The animated request walkthroughs. A flow is authored as plain data, then
 * compiled into timed steps, the same way the neural network timeline works:
 * any frame can be drawn from (step, progress), so Next and Prev are trivial.
 */

import type { SnippetId } from "./snippets.generated.ts";

export type IconKind =
  | "client" | "dns" | "cdn" | "proxy" | "lb" | "api" | "redis" | "db" | "queue"
  | "worker" | "storage" | "limiter" | "auth" | "service" | "module" | "tenant" | "attacker";

/** One colour per idea, matching the rest of the site. */
export type Tone = "request" | "response" | "job" | "error" | "data";

export const TONE_COLOR: Record<Tone, string> = {
  request: "var(--signal)",
  response: "var(--update)",
  job: "var(--grad)",
  error: "var(--loss)",
  data: "var(--neg)",
};

export const TONE_LABEL: Record<Tone, string> = {
  request: "Request",
  response: "Response",
  job: "Background work",
  error: "Rejected or failed",
  data: "Stored data",
};

export interface FlowNode {
  id: string;
  kind: IconKind;
  label: string;
  sub?: string;
  /** Position on the stage, 0 to 1 on each axis. */
  x: number;
  y: number;
}

export type Hop = [from: string, to: string, label: string, tone: Tone];

export interface CardRow {
  t: string;
  tone?: Tone | "muted";
  strong?: boolean;
}

export interface FlowCard {
  at: string;
  title: string;
  tag?: string;
  tone?: Tone;
  rows: Array<string | CardRow>;
}

export interface FlowStepSpec {
  title: string;
  body: string;
  /** Short name of the stage this step belongs to, shown on the timeline. */
  phase: string;
  /** Sent one after another, in order. */
  hops?: Hop[];
  /** Sent at the same moment. */
  fan?: Hop[];
  card?: FlowCard;
  /** Replaces the state lines shown under a node. Null clears them. */
  set?: Record<string, string[] | null>;
  /** Marks a node as failed. */
  down?: string[];
  up?: string[];
  note?: string;
  /** Tested code that runs at this step. */
  code?: SnippetId;
}

export interface Scenario {
  id: string;
  label: string;
  summary: string;
  steps: FlowStepSpec[];
}

export interface FlowSpec {
  nodes: FlowNode[];
  scenarios: Scenario[];
}

/* ---------- compiled ---------- */

export interface TimedHop {
  from: string;
  to: string;
  label: string;
  tone: Tone;
  window: [number, number];
}

export interface CompiledCard {
  at: string;
  title: string;
  tag?: string;
  tone: Tone;
  rows: { t: string; tone: Tone | "muted" | "plain"; strong: boolean; at: number }[];
}

export interface NodeState {
  lines: Record<string, string[]>;
  down: string[];
}

export interface FlowStep {
  id: string;
  title: string;
  body: string;
  phase: string;
  duration: number;
  hops: TimedHop[];
  card?: CompiledCard;
  focus: string[] | null;
  before: NodeState;
  after: NodeState;
  note?: string;
  code?: SnippetId;
}

export interface CompiledScenario {
  id: string;
  label: string;
  summary: string;
  steps: FlowStep[];
  edges: [string, string][];
  phases: Record<string, { label: string; color: string }>;
}

const HOP_MS = 950;
const ROW_MS = 420;
/** Phase colours rotate through the site palette in order of appearance. */
const PHASE_COLORS = ["var(--signal)", "var(--grad)", "var(--update)", "var(--loss)", "var(--pos)", "var(--neg)"];

const sameNodeState = (s: NodeState): NodeState => ({ lines: { ...s.lines }, down: [...s.down] });

export function compileScenario(spec: FlowSpec, scenario: Scenario): CompiledScenario {
  const ids = new Set(spec.nodes.map((n) => n.id));
  const assertNode = (id: string, where: string) => {
    if (!ids.has(id)) throw new Error(`${scenario.id}: unknown node "${id}" in ${where}`);
  };

  let state: NodeState = { lines: {}, down: [] };
  const edgeSet = new Map<string, [string, string]>();
  const phases: CompiledScenario["phases"] = {};

  const steps = scenario.steps.map((s, index) => {
    const sequential = s.hops ?? [];
    const parallel = s.fan ?? [];
    const rowCount = s.card?.rows.length ?? 0;
    const slots = sequential.length + (parallel.length ? 1 : 0);
    const travelMs = slots * HOP_MS;
    const cardMs = s.card ? 500 + rowCount * ROW_MS : 0;
    const duration = Math.max(1300, 350 + travelMs + cardMs + 450);
    const travelEnd = (350 + travelMs) / duration;
    const slot = slots ? (travelEnd - 0.03) / slots : 0;

    const hops: TimedHop[] = [];
    const add = ([from, to, label, tone]: Hop, at: number) => {
      assertNode(from, `step "${s.title}"`);
      assertNode(to, `step "${s.title}"`);
      hops.push({ from, to, label, tone, window: [0.03 + slot * at, 0.03 + slot * (at + 0.92)] });
      const key = [from, to].sort().join("|");
      if (!edgeSet.has(key)) edgeSet.set(key, [from, to]);
    };
    sequential.forEach((h, i) => add(h, i));
    parallel.forEach((h) => add(h, sequential.length));

    let card: CompiledCard | undefined;
    if (s.card) {
      assertNode(s.card.at, `card of "${s.title}"`);
      const start = travelEnd + 450 / duration;
      const span = Math.max(0.01, 0.97 - start);
      card = {
        at: s.card.at,
        title: s.card.title,
        tag: s.card.tag,
        tone: s.card.tone ?? "request",
        rows: s.card.rows.map((row, i) => {
          const r = typeof row === "string" ? { t: row } : row;
          return {
            t: r.t,
            tone: r.tone ?? "plain",
            strong: r.strong ?? false,
            at: start + (span * i) / Math.max(rowCount, 1),
          };
        }),
      };
    }

    const after = sameNodeState(state);
    for (const [id, lines] of Object.entries(s.set ?? {})) {
      assertNode(id, `set of "${s.title}"`);
      if (lines === null) delete after.lines[id];
      else after.lines[id] = lines;
    }
    for (const id of s.down ?? []) {
      assertNode(id, `down of "${s.title}"`);
      if (!after.down.includes(id)) after.down.push(id);
    }
    after.down = after.down.filter((id) => !(s.up ?? []).includes(id));

    const touched = new Set<string>([
      ...hops.flatMap((h) => [h.from, h.to]),
      ...(s.card ? [s.card.at] : []),
      ...Object.keys(s.set ?? {}),
      ...(s.down ?? []),
      ...(s.up ?? []),
    ]);

    if (!phases[s.phase]) {
      phases[s.phase] = {
        label: s.phase,
        color: PHASE_COLORS[Object.keys(phases).length % PHASE_COLORS.length]!,
      };
    }

    const step: FlowStep = {
      id: `${scenario.id}-${index}`,
      title: s.title,
      body: s.body,
      phase: s.phase,
      duration,
      hops,
      card,
      focus: touched.size ? [...touched] : null,
      before: state,
      after,
      note: s.note,
      code: s.code,
    };
    state = after;
    return step;
  });

  return {
    id: scenario.id,
    label: scenario.label,
    summary: scenario.summary,
    steps,
    edges: [...edgeSet.values()],
    phases,
  };
}
