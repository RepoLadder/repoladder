// Layout lint: objective defects and neatness numbers for a laid-out board, measured on what the
// viewer draws (outline.ts), so agents can check a layout change without a judge.
import type { Model, ModelEdge } from "../model/rollup.ts";
import { CANVAS, boardOf, type BoardLayout } from "./layout.ts";
import { isFileBoard } from "./filelayout.ts";
import { MORE } from "../model/fileboards.ts";
import { STORY, wireLabel, type PageEdge } from "../viewer/state.ts";
import { samples } from "../viewer/labels.ts";
import { labelRect, labelShown, placeBoardLabels } from "../viewer/placement.ts";
import { boardViewBox } from "../viewer/bounds.ts";
import { NAME_PX } from "../viewer/fit.ts";
import { isCollId } from "../model/storeboards.ts";
import { cylGap } from "./cylgap.ts";
import { bbox, crosses, drawnBoxes, overlapPairs, overlapWH, segCross, signedDist, type Drawn, type Pt, type Rect } from "./outline.ts";

/** How far off a line may be and still count as touching (px, board units). */
export const TOL = 2;

export type DefectKind = "overlap" | "endpoint" | "label" | "through" | "clipped";
export interface Defect { kind: DefectKind; ids: string[]; detail: string }

export interface Metrics {
  direction: "right" | "down";
  /** Boxes in multi-box layers that share an edge or center line with another box of their layer (within TOL). */
  aligned: number;
  layered: number;
  /** Coefficient of variation of box widths, per kind with 2+ boxes. */
  widthCV: Record<string, number>;
  crossings: number;
  /** Distinct pairs of wires drawn on top of each other along a shared stretch (outline.ts sharedRuns). */
  overlapWires: number;
  bendsPerEdge: number;
  maxBends: number;
  /** Rendered size of a box name when the board is fitted to the 1280×800 desktop canvas. */
  namePx: number;
  /** Share of the fitted canvas covered by neither a box nor a label. */
  wasted: number;
  /** Store-verb labels with no free spot: hidden until zoomed in or lit (labels.ts). */
  hiddenLabels: number;
  /** Boxes with a connection on the board but no drawn arrow: they read as unused (#126). */
  orphans: string[];
  /** Smallest visible gap between two cylinders stacked in a column (cylgap.ts); null when none are. */
  cylGap: number | null;
}

export interface BoardLint { board: string; defects: Defect[]; metrics: Metrics }

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pts = (curve: 0 | 1, p: number[]): Pt[] => samples(curve, p);

/** The edge labels as the viewer places them (draw.ts), with the ones a reader sees at the fit. */
function labels(model: Model, boardId: string, layout: BoardLayout) {
  const info = new Map(boardOf(model, boardId).edges.map((e): [string, ModelEdge] => [`${e.a}>${e.b}`, e]));
  const placed = placeBoardLabels(layout, info, (e) => wireLabel(e as unknown as PageEdge));
  // a story pill always shows (figures.ts); a store verb with no free spot waits for a zoom (`lo`)
  return [...placed].map(([e, l]) => ({ e, lo: !e.says && l.at.lo, show: labelShown(e, l), rect: labelRect(l) }));
}

/**
 * The way the layout flows. ELK's orthogonal wires leave their box sideways on a right-flowing board
 * and downward on a down-flowing one; dagre's curves are judged by where they go overall.
 */
function direction(layout: BoardLayout): "right" | "down" {
  let side = 0, down = 0;
  for (const [, , curve, ...p] of layout.e) {
    const [x1, y1] = curve ? p.slice(-2) : [p[2], p[3]];
    if (Math.abs(x1 - p[0]) > Math.abs(y1 - p[1])) side++; else down++;
  }
  return side >= down ? "right" : "down";
}

/** Layers: boxes whose extent along the flow overlaps by at least half the narrower one. */
function alignment(boxes: Drawn[], dir: "right" | "down"): { aligned: number; layered: number } {
  const span = (d: Drawn): [number, number] => (dir === "right" ? [d.box.x, d.box.w] : [d.box.y, d.box.h]);
  // a layer of a right-flowing board is a column, so its boxes line up on their left, center or right
  const along = (d: Drawn): number[] => (dir === "right" ? [d.box.x, d.box.x + d.box.w / 2, d.box.x + d.box.w] : [d.box.y, d.box.y + d.box.h / 2, d.box.y + d.box.h]);
  const sorted = [...boxes].sort((a, b) => span(a)[0] - span(b)[0] || a.id.localeCompare(b.id));
  const layers: Drawn[][] = [];
  for (const d of sorted) {
    const [s, l] = span(d);
    const hit = layers.find((L) => L.some((o) => { const [os, ol] = span(o); return Math.min(s + l, os + ol) - Math.max(s, os) >= Math.min(l, ol) / 2; }));
    if (hit) hit.push(d); else layers.push([d]);
  }
  let aligned = 0, layered = 0;
  for (const L of layers) {
    if (L.length < 2) continue;
    layered += L.length;
    for (const d of L) if (L.some((o) => o !== d && along(d).some((v, i) => Math.abs(v - along(o)[i]) <= TOL))) aligned++;
  }
  return { aligned, layered };
}

function bends(curve: 0 | 1, p: number[]): number {
  if (curve) return Math.max(0, Math.floor((p.length - 2) / 6) - 1);
  let n = 0;
  for (let i = 2; i + 3 < p.length; i += 2) {
    const a = Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]), b = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]);
    const turn = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (turn > 0.17) n++;
  }
  return n;
}

const cv = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return m ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) / m : 0;
};

/** How far a rect reaches past a viewBox [x, y, w, h] on its worst side (≤ 0 when inside). */
export const outsideBy = (vb: readonly number[], r: Rect) => Math.max(vb[0] - r.x, vb[1] - r.y, r.x + r.w - vb[0] - vb[2], r.y + r.h - vb[1] - vb[3]);

/** Lints one laid-out board. Pure: the same model and layout give the same result. */
export function lintBoard(model: Model, boardId: string, layout: BoardLayout): BoardLint {
  const drawn = drawnBoxes(model, boardId, layout.n);
  const byId = new Map(drawn.map((d) => [d.id, d]));
  const solid = new Map(drawn.map((d) => [d.id, d.parts.map(bbox)]));
  const defects: Defect[] = [];
  const near = (a: Rect, b: Rect) => { const [w, h] = overlapWH(a, b); return w > TOL && h > TOL; };

  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const A = drawn[i], B = drawn[j];
    // on a store board a subcollection sits inside its parent collection's box on purpose (storelayout.ts)
    if (isCollId(A.id) && isCollId(B.id) && (B.id.startsWith(`${A.id}/`) || A.id.startsWith(`${B.id}/`))) continue;
    if (solid.get(A.id)!.some((a) => solid.get(B.id)!.some((b) => near(a, b)))) defects.push({ kind: "overlap", ids: [A.id, B.id], detail: "boxes overlap" });
  }

  const wires = layout.e.map(([a, z, curve, ...p]) => ({ a, z, curve, p, s: pts(curve, p) }));
  for (const w of wires) {
    const A = byId.get(w.a), Z = byId.get(w.z);
    const start: Pt = [w.p[0], w.p[1]], end: Pt = [w.p[w.p.length - 2], w.p[w.p.length - 1]];
    // the tail may start under its box (boxes are drawn over wires); the arrowhead must touch
    const ds = A ? signedDist(start, A.parts) : 0, de = Z ? signedDist(end, Z.parts) : 0;
    if (ds > TOL) defects.push({ kind: "endpoint", ids: [w.a, w.z], detail: `starts ${r1(ds)}px short of ${w.a}` });
    if (Math.abs(de) > TOL) defects.push({ kind: "endpoint", ids: [w.a, w.z], detail: de > 0 ? `stops ${r1(de)}px short of ${w.z}` : `arrowhead ${r1(-de)}px inside ${w.z}` });
    for (const d of drawn) {
      if (d.id === w.a || d.id === w.z) continue;
      if (crosses(w.s, solid.get(d.id)!, TOL)) defects.push({ kind: "through", ids: [w.a, w.z, d.id], detail: `${w.a} → ${w.z} passes through ${d.id}` });
    }
  }

  const labs = labels(model, boardId, layout), shown = labs.filter((l) => l.show);
  for (const [i, l] of shown.entries()) {
    for (const d of drawn) if (solid.get(d.id)!.some((r) => near(l.rect, r))) defects.push({ kind: "label", ids: [l.e.a, l.e.b, d.id], detail: `label of ${l.e.a} → ${l.e.b} covers ${d.id}` });
    for (const m of shown.slice(i + 1)) if (near(l.rect, m.rect)) defects.push({ kind: "label", ids: [l.e.a, l.e.b, m.e.a, m.e.b], detail: `labels of ${l.e.a} → ${l.e.b} and ${m.e.a} → ${m.e.b} overlap` });
  }

  // the frame the viewer fits (bounds.ts): a label outside it is cut off at the edge of the fitted view (#137)
  const vb = boardViewBox(layout, isFileBoard(model, boardId) || !!model.stores?.[boardId], shown.map((l) => l.rect));
  for (const l of shown) {
    const out = outsideBy(vb, l.rect);
    if (out > TOL) defects.push({ kind: "clipped", ids: [l.e.a, l.e.b], detail: `label of ${l.e.a} → ${l.e.b} is ${r1(out)}px outside the board` });
  }

  let crossings = 0;
  for (let i = 0; i < wires.length; i++) for (let j = i + 1; j < wires.length; j++) {
    const A = wires[i], B = wires[j], ends = [A.s[0], A.s[A.s.length - 1], B.s[0], B.s[B.s.length - 1]];
    const seen: Pt[] = [];
    for (let s = 1; s < A.s.length; s++) for (let t = 1; t < B.s.length; t++) {
      const x = segCross(A.s[s - 1], A.s[s], B.s[t - 1], B.s[t]);
      // wires that meet at a shared box are not a crossing; nor is one crossing counted twice
      if (!x || ends.some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) < 8) || seen.some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) < 4)) continue;
      seen.push(x);
      crossings++;
    }
  }

  const kinds = new Map<string, number[]>();
  for (const d of drawn) kinds.set(d.kind, [...(kinds.get(d.kind) ?? []), d.box.w]);
  const widthCV = Object.fromEntries([...kinds].filter(([, ws]) => ws.length > 1).sort(([a], [b]) => a.localeCompare(b)).map(([k, ws]) => [k, r2(cv(ws))]));

  const b = wires.map((w) => bends(w.curve, w.p));
  const [, , W, H] = vb;
  const fit = Math.min(CANVAS[0] / W, CANVAS[1] / H);
  const covered = [...solid.values()].flat().reduce((s, r) => s + r.w * r.h, 0) + shown.reduce((s, l) => s + l.rect.w * l.rect.h, 0);
  const dir = direction(layout);
  return {
    board: boardId, defects,
    metrics: {
      direction: dir, ...alignment(drawn, dir), widthCV, crossings, overlapWires: overlapPairs(layout),
      bendsPerEdge: r2(b.length ? b.reduce((s, x) => s + x, 0) / b.length : 0), maxBends: Math.max(0, ...b),
      // names are 16px on the story level and 13px in file boxes (styles.css), 14.5px elsewhere
      namePx: r1((boardId === STORY ? 16 : isFileBoard(model, boardId) ? 13 : NAME_PX) * fit),
      wasted: r2(Math.max(0, 1 - (covered * fit * fit) / (CANVAS[0] * CANVAS[1]))),
      hiddenLabels: labs.filter((l) => l.lo).length,
      orphans: orphans(model, boardId, layout),
      cylGap: cylGap(drawn),
    },
  };
}

/**
 * Drawn boxes that have an edge on the board (to anything that is or could be drawn: not a service
 * listed as "used throughout", not the "+N more" box) yet no wire. Store boards draw their arrows
 * only for the selected collection (collections.ts), so they have none by design.
 */
export function orphans(model: Model, boardId: string, layout: BoardLayout): string[] {
  if (model.stores?.[boardId]) return [];
  const b = boardOf(model, boardId), wired = new Set(layout.e.flatMap(([a, z]) => [a, z]));
  const bare = new Set([...b.throughout, MORE]);
  const linked = new Set(b.edges.filter((e) => e.a !== e.b && !bare.has(e.a) && !bare.has(e.b)).flatMap((e) => [e.a, e.b]));
  return layout.n.map(([id]) => id).filter((id) => id !== MORE && linked.has(id) && !wired.has(id)).sort();
}

/** Every board of a model, the story level first. */
export function lintModel(model: Model, layouts: Record<string, BoardLayout>): BoardLint[] {
  const ids = Object.keys(layouts).sort((a, b) => (a === STORY ? -1 : b === STORY ? 1 : a.localeCompare(b)));
  return ids.map((id) => lintBoard(model, id, layouts[id]));
}

export interface LintSummary {
  boards: number;
  /** Boards with at least one hard defect, and the defects by kind. */
  defectBoards: number;
  defects: Record<DefectKind, number>;
  /** Over all boards: aligned share of layered boxes, total crossings, mean bends, median name size, mean waste. */
  aligned: number;
  crossings: number;
  /** Wire pairs drawn on top of each other, over all boards. */
  overlapWires: number;
  bendsPerEdge: number;
  namePx: number;
  wasted: number;
  /** Boxes with a connection but no drawn arrow, over all boards; should be zero. */
  orphans: number;
  /** The smallest gap between stacked cylinders on any board; null when no board stacks them. */
  cylGap: number | null;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function summarizeLint(lints: BoardLint[]): LintSummary {
  const defects: Record<DefectKind, number> = { overlap: 0, endpoint: 0, label: 0, through: 0, clipped: 0 };
  for (const l of lints) for (const d of l.defects) defects[d.kind]++;
  const layered = lints.reduce((s, l) => s + l.metrics.layered, 0);
  return {
    boards: lints.length, defectBoards: lints.filter((l) => l.defects.length).length, defects,
    aligned: r2(layered ? lints.reduce((s, l) => s + l.metrics.aligned, 0) / layered : 1),
    crossings: lints.reduce((s, l) => s + l.metrics.crossings, 0),
    overlapWires: lints.reduce((s, l) => s + l.metrics.overlapWires, 0),
    bendsPerEdge: r2(mean(lints.map((l) => l.metrics.bendsPerEdge))),
    namePx: r1(median(lints.map((l) => l.metrics.namePx))),
    wasted: r2(mean(lints.map((l) => l.metrics.wasted))),
    orphans: lints.reduce((s, l) => s + l.metrics.orphans.length, 0),
    cylGap: lints.reduce<number | null>((m, l) => (l.metrics.cylGap === null ? m : m === null ? l.metrics.cylGap : Math.min(m, l.metrics.cylGap)), null),
  };
}

/** Worst first: most hard defects, then the smallest names at the fit. */
export const worstBoards = (lints: BoardLint[]) => [...lints].sort((a, b) => b.defects.length - a.defects.length || a.metrics.namePx - b.metrics.namePx || a.board.localeCompare(b.board));
