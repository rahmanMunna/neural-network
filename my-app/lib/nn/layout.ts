import type { Card, Port } from "./timeline.ts";

export interface NeuronPos {
  l: number;
  j: number;
  x: number;
  y: number;
}

export interface StageLayout {
  width: number;
  height: number;
  r: number;
  columns: number[];
  neurons: NeuronPos[][];
  loss: { x: number; y: number; w: number; h: number };
}

export interface Point {
  x: number;
  y: number;
}

const TOP = 54;
const LEFT = 132;
/** The gap after the output layer is the width of the loss card plus a margin. */
const RIGHT = 356;

export function computeLayout(sizes: number[], width: number, height: number, bottomPad = 26): StageLayout {
  const L = sizes.length - 1;
  const span = Math.max(1, width - LEFT - RIGHT);
  const columns = sizes.map((_, l) => LEFT + (L === 0 ? 0 : (span * l) / L));
  const usable = height - TOP - bottomPad;
  const widest = Math.max(...sizes);
  const gap = Math.min(usable / Math.max(widest, 1), 104);
  const r = Math.max(12, Math.min(30, gap * 0.42));
  const midY = TOP + usable / 2;
  const neurons = sizes.map((n, l) =>
    Array.from({ length: n }, (_, j) => ({
      l,
      j,
      x: columns[l],
      y: midY + (j - (n - 1) / 2) * gap,
    })),
  );
  return {
    width,
    height,
    r,
    columns,
    neurons,
    loss: { x: width - 92, y: midY, w: 116, h: 64 },
  };
}

/* ----- curves ----- */

export interface Curve {
  p0: Point;
  c0: Point;
  c1: Point;
  p1: Point;
}

/**
 * S-curve that leaves and enters horizontally. When the path runs right to
 * left (a gradient travelling back) the handles flip so it still leaves its
 * start pointing the way it is going.
 */
export function curveBetween(a: Point, b: Point): Curve {
  const dx = b.x - a.x;
  const pull = Math.abs(dx) * 0.46;
  const s = dx >= 0 ? 1 : -1;
  return {
    p0: a,
    c0: { x: a.x + s * pull, y: a.y },
    c1: { x: b.x - s * pull, y: b.y },
    p1: b,
  };
}

export const curvePath = (c: Curve) =>
  `M${c.p0.x.toFixed(1)} ${c.p0.y.toFixed(1)}C${c.c0.x.toFixed(1)} ${c.c0.y.toFixed(1)} ${c.c1.x.toFixed(1)} ${c.c1.y.toFixed(1)} ${c.p1.x.toFixed(1)} ${c.p1.y.toFixed(1)}`;

export function curvePoint(c: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c0.x + d * c.c1.x + e * c.p1.x,
    y: a * c.p0.y + b * c.c0.y + d * c.c1.y + e * c.p1.y,
  };
}

export function edgeCurve(layout: StageLayout, l: number, j: number, i: number): Curve {
  const a = layout.neurons[l - 1][i];
  const b = layout.neurons[l][j];
  return curveBetween({ x: a.x + layout.r, y: a.y }, { x: b.x - layout.r, y: b.y });
}

/* ----- cards ----- */

export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  from: { x: number; y: number; w: number; h: number; rx: number };
  rowH: number;
  font: number;
  rows: Record<string, { x: number; y: number; port: Point; column: "left" | "right" }>;
  headings: { text: string; x: number; y: number }[];
  plot?: { x: number; y: number; w: number; h: number };
  divider?: number;
}

const PAD = 14;
const HEAD = 38;
const COLHEAD = 20;
const GAP = 22;
const PLOT_W = 158;
const STACK_PLOT_H = 112;

export function layoutCard(card: Card, s: StageLayout): CardLayout {
  const leftRows = card.left?.rows.length ?? 0;
  const rightRows = card.right?.rows.length ?? 0;
  const maxRows = Math.max(leftRows, rightRows);
  const leftW = card.left?.width ?? 0;
  const rightW = card.right?.width ?? 0;
  const hasPlot = Boolean(card.plot);
  // The loss card lives in the narrow gap after the output, so its plot stacks.
  const stacked = hasPlot && card.seat === "loss";
  const sidePlot = hasPlot && !stacked;
  const w = PAD * 2 + leftW + (rightW ? GAP + rightW : 0) + (sidePlot ? GAP + PLOT_W : 0);

  const maxH = s.height - 16;
  const idealRow = 25;
  const room = (maxH - HEAD - COLHEAD - PAD) / Math.max(maxRows, 1);
  const rowH = Math.max(15, Math.min(idealRow, room));
  const font = rowH < 19 ? 10.5 : 12.5;
  const rowsH = HEAD + COLHEAD + rowH * maxRows;
  const h = stacked ? rowsH + 8 + STACK_PLOT_H + PAD : Math.max(rowsH + PAD, sidePlot ? 176 : 0);

  let cy: number;
  let from: CardLayout["from"];
  let x: number;

  if (card.anchor.kind === "neuron") {
    const n = s.neurons[card.anchor.l][card.anchor.j];
    cy = n.y;
    from = { x: n.x - s.r, y: n.y - s.r, w: s.r * 2, h: s.r * 2, rx: s.r };
    const prevX = card.anchor.l > 0 ? s.columns[card.anchor.l - 1] : 0;
    const nextX = s.columns[card.anchor.l + 1] ?? s.loss.x - s.loss.w / 2;
    if (card.seat === "between") {
      // Leave more room on the left, where the gradient labels land.
      x = prevX + s.r + Math.max(70, (nextX - prevX - s.r * 2 - w) * 0.6);
      if (card.anchor.l === s.columns.length - 1) x = Math.min(x, s.loss.x - s.loss.w / 2 - w - 8);
    } else {
      x = Math.max(n.x - 96, prevX + s.r + 58);
    }
  } else {
    cy = s.loss.y;
    from = {
      x: s.loss.x - s.loss.w / 2,
      y: s.loss.y - s.loss.h / 2,
      w: s.loss.w,
      h: s.loss.h,
      rx: 12,
    };
    x = s.width - w - 12;
  }

  x = Math.max(10, Math.min(s.width - w - 10, x));
  // Stay below the column headings whenever the card is short enough to.
  const minY = h + TOP + 8 <= s.height ? TOP - 8 : 8;
  const y = Math.max(minY, Math.min(s.height - h - 8, cy - h / 2));

  const rows: CardLayout["rows"] = {};
  const headings: CardLayout["headings"] = [];
  const top = y + HEAD;
  const firstRow = top + COLHEAD + rowH * 0.5;

  const placeColumn = (col: Card["left"], colX: number, side: "left" | "right") => {
    if (!col) return;
    headings.push({ text: col.heading, x: colX, y: top + 8 });
    col.rows.forEach((row, idx) => {
      const ry = firstRow + rowH * idx;
      rows[row.id] = {
        x: colX,
        y: ry,
        column: side,
        port: { x: side === "left" ? x : x + w, y: ry },
      };
    });
  };

  const leftX = x + PAD;
  placeColumn(card.left, leftX, "left");
  const rightX = leftX + leftW + GAP;
  if (card.right) placeColumn(card.right, rightX, "right");

  const plot = stacked
    ? { x: x + PAD, y: y + rowsH + 8, w: w - PAD * 2, h: STACK_PLOT_H }
    : sidePlot
      ? { x: x + w - PAD - PLOT_W, y: y + HEAD + 2, w: PLOT_W, h: h - HEAD - PAD }
      : undefined;

  return {
    x,
    y,
    w,
    h,
    from,
    rowH,
    font,
    rows,
    headings,
    plot,
    divider: card.right || sidePlot ? leftX + leftW + GAP / 2 : undefined,
  };
}

export function portPoint(port: Port, s: StageLayout, card: CardLayout | null, side: "out" | "in"): Point {
  switch (port.kind) {
    case "neuron": {
      const n = s.neurons[port.l][port.j];
      return { x: n.x + (side === "out" ? s.r : -s.r), y: n.y };
    }
    case "row":
      return card?.rows[port.id]?.port ?? { x: s.loss.x, y: s.loss.y };
    case "loss":
      return { x: s.loss.x - s.loss.w / 2, y: s.loss.y };
    case "input": {
      const n = s.neurons[0][port.j];
      return { x: Math.max(6, n.x - 92), y: n.y };
    }
  }
}
