// What a box looks like on the board, as polygons, for the layout lint (lint.ts) and for layout.ts,
// which ends wires on these outlines. The numbers come from the drawing modules (shapes.ts,
// figures.ts), so both work on what the reader sees rather than the box D2 reserved: an openable part
// has its stacked cards, a service is a cylinder with a curved lid, an actor is its card.
import type { Model } from "../model/rollup.ts";
import { FILE, MORE } from "../model/fileboards.ts";
import { STORY } from "../viewer/state.ts";
import { CARD_RX } from "../viewer/figures.ts";
import { R, STACK, lidRy } from "../viewer/shapes.ts";
import { samples } from "../viewer/labels.ts";

export type Pt = [number, number];
export interface Rect { x: number; y: number; w: number; h: number }

export interface Drawn {
  id: string;
  /** What D2 laid out. */
  box: Rect;
  /** The drawn silhouette: one closed polygon per opaque part (body, stacked cards). */
  parts: Pt[][];
  /** Kind for the width-spread metric. */
  kind: string;
}

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 8): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
}

export function roundRect({ x, y, w, h }: Rect, r: number): Pt[] {
  r = Math.min(r, w / 2, h / 2);
  const P = Math.PI;
  return [...arc(x + w - r, y + r, r, r, -P / 2, 0, 4), ...arc(x + w - r, y + h - r, r, r, 0, P / 2, 4), ...arc(x + r, y + h - r, r, r, P / 2, P, 4), ...arc(x + r, y + r, r, r, P, 1.5 * P, 4)];
}

function cylinder({ x, y, w, h }: Rect): Pt[] {
  const ry = lidRy(h), P = Math.PI;
  return [...arc(x + w / 2, y + ry, w / 2, ry, P, 2 * P, 16), ...arc(x + w / 2, y + h - ry, w / 2, ry, 0, P, 16)];
}

/** How far the stacked cards reach past an openable box, right and down. */
export const STACK_PAD = Math.max(...STACK);

/**
 * Whether a box is drawn with stacked cards behind it (shapes.ts): a part or data store that opens
 * into a board of its own. Context boxes, files, actors and store-board boxes never are.
 */
export function isStacked(model: Model, boardId: string, id: string): boolean {
  if (!model.boards[id] || !(model.nodes[id] || model.stores?.[id]) || model.stores?.[boardId]) return false;
  if (boardId === STORY && model.story!.actors[id]) return false;
  const b = boardId === STORY ? model.story!.board : model.boards[boardId];
  return !!model.services[id] || !b.context.includes(id);
}

/** Every box of a board as drawn. */
export function drawnBoxes(model: Model, boardId: string, n: [string, number, number, number, number, 0 | 1][]): Drawn[] {
  const b = boardId === STORY ? model.story!.board : model.boards[boardId];
  return n.map(([id, x, y, w, h, cyl]) => {
    const box = { x, y, w, h };
    const actor = boardId === STORY ? model.story!.actors[id] : undefined;
    const stack = isStacked(model, boardId, id) ? STACK.map((d) => ({ x: x + d, y: y + d, w, h })) : [];
    if (actor) return { id, box, parts: [roundRect(box, CARD_RX)], kind: "actor" };
    if (cyl) return { id, box, parts: [box, ...stack].map(cylinder), kind: id.startsWith("store-") ? "store" : "service" };
    if (id.startsWith(FILE) || id === MORE) return { id, box, parts: [roundRect(box, 4)], kind: "file" };
    if (b.context.includes(id)) return { id, box, parts: [roundRect(box, 8)], kind: "elsewhere" };
    const k = model.nodes[id]?.kind ?? "part", r = R[k];
    return { id, box, parts: [box, ...stack].map((q) => roundRect(q, r)), kind: k };
  });
}

export function bbox(pts: Pt[]): Rect {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export const edgeDist = (p: Pt, poly: Pt[]) => Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])));

/**
 * Signed distance from a point to a silhouette: positive outside (a gap), negative inside (hidden
 * under the box, which is drawn over the wires). Inside, it is the depth in the deepest part.
 */
export function signedDist(p: Pt, parts: Pt[][]): number {
  const deep = parts.filter((q) => inside(p, q)).map((q) => edgeDist(p, q));
  return deep.length ? -Math.max(...deep) : Math.min(...parts.map((q) => edgeDist(p, q)));
}

/** Whether segment a-b crosses the rect (Liang–Barsky clipping). */
export function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r.x], [dx, r.x + r.w - a[0]], [-dy, a[1] - r.y], [dy, r.y + r.h - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** Intersection point of segments a-b and c-d, if they properly cross. */
export function segCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

/** Overlap of two rects: [width, height], both positive when they overlap. */
export const overlapWH = (a: Rect, b: Rect): [number, number] => [Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)];

/**
 * Where a ray from `from` along the unit vector `u` first enters a silhouette (the union of its
 * parts), within `max` px, as a distance along the ray; null when it never does or starts inside.
 */
function entry(from: Pt, u: Pt, max: number, parts: Pt[][]): number | null {
  const inAny = (p: Pt) => parts.some((q) => inside(p, q));
  if (inAny(from)) return null;
  const to: Pt = [from[0] + u[0] * max, from[1] + u[1] * max], ts: number[] = [];
  for (const q of parts) for (let i = 0; i < q.length; i++) {
    const x = segCross(from, to, q[i], q[(i + 1) % q.length]);
    if (x) ts.push(Math.hypot(x[0] - from[0], x[1] - from[1]));
  }
  ts.sort((a, b) => a - b);
  // the first crossing that goes from outside every part to inside one (not one card's edge under another)
  return ts.find((t) => !inAny([from[0] + u[0] * (t - 0.05), from[1] + u[1] * (t - 0.05)]) && inAny([from[0] + u[0] * (t + 0.05), from[1] + u[1] * (t + 0.05)])) ?? null;
}

/** How far past its routed end a wire may grow to reach the drawn outline (a cylinder's lid, a card's corner). */
const REACH = 24;

/**
 * Moves the ends of a polyline wire along its first and last segments onto the drawn outlines of its
 * boxes: ELK routes to the rectangle it laid out, but the reader sees stacked cards, rounded corners
 * and a cylinder's curved lid. The segments keep their direction, so orthogonal wires stay orthogonal.
 */
export function snapEnds(p: number[], from: Pt[][] | undefined, to: Pt[][] | undefined): number[] {
  const out = [...p];
  const snap = (end: number, prev: number, parts: Pt[][]) => {
    const P: Pt = [out[prev], out[prev + 1]], dx = out[end] - P[0], dy = out[end + 1] - P[1], len = Math.hypot(dx, dy);
    if (len < 1) return;
    const u: Pt = [dx / len, dy / len], t = entry(P, u, len + REACH, parts);
    if (t !== null) { out[end] = Math.round(P[0] + u[0] * t); out[end + 1] = Math.round(P[1] + u[1] * t); }
  };
  const n = out.length;
  if (n < 4) return out;
  if (to) snap(n - 2, n - 4, to);
  if (from) snap(0, 2, from);
  return out;
}

/** A board layout with every straight-segment wire's ends on its boxes' drawn outlines (snapEnds). */
export function snapWires<L extends { n: [string, number, number, number, number, 0 | 1][]; e: [string, string, 0 | 1, ...number[]][] }>(model: Model, boardId: string, layout: L): L {
  const parts = new Map(drawnBoxes(model, boardId, layout.n).map((d) => [d.id, d.parts]));
  return { ...layout, e: layout.e.map(([a, z, curve, ...p]) => (curve ? [a, z, curve, ...p] : [a, z, curve, ...snapEnds(p, parts.get(a), parts.get(z))])) };
}

/** Whether a wire (as sample points) crosses any of a box's opaque parts, each shrunk by `inset` px. */
export function crosses(s: Pt[], solid: Rect[], inset: number): boolean {
  const shrunk = solid.map((r) => ({ x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset }));
  return s.some((q, i) => i > 0 && shrunk.some((r) => segHitsRect(s[i - 1], q, r)));
}

/** The wires ("a>b") that pass through a box that is not one of their ends. */
export function throughWires(model: Model, boardId: string, layout: { n: [string, number, number, number, number, 0 | 1][]; e: [string, string, 0 | 1, ...number[]][] }, inset = 2): Set<string> {
  const solid = drawnBoxes(model, boardId, layout.n).map((d) => [d.id, d.parts.map(bbox)] as const), out = new Set<string>();
  for (const [a, z, curve, ...p] of layout.e) {
    const s = samples(curve, p);
    if (solid.some(([id, rs]) => id !== a && id !== z && crosses(s, rs, inset))) out.add(`${a}>${z}`);
  }
  return out;
}

type WireLayout = { n: [string, number, number, number, number, 0 | 1][]; e: [string, string, 0 | 1, ...number[]][] };
/** Wires drawn on top of each other along one line: `segs` are [wire index, segment index]. */
export interface Run { wires: number[]; horizontal: boolean; at: number; from: number; to: number; segs: [number, number][] }
const TOL_RUN = 1;

/** Stretches where two or more straight-segment wires share a line for more than `min` px (touching at a point is not one). */
export function sharedRuns(layout: { e: WireLayout["e"] }, min = 4): Run[] {
  const all: { w: number; s: number; h: boolean; at: number; lo: number; hi: number }[] = [];
  layout.e.forEach(([, , curve, ...p], w) => {
    if (curve) return;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], h = Math.abs(dy) <= 0.5 && Math.abs(dx) > 0.5;
      if (!h && !(Math.abs(dx) <= 0.5 && Math.abs(dy) > 0.5)) continue;
      const a = h ? [p[i], p[i + 2], (p[i + 1] + p[i + 3]) / 2] : [p[i + 1], p[i + 3], (p[i] + p[i + 2]) / 2];
      all.push({ w, s: i / 2, h, at: a[2], lo: Math.min(a[0], a[1]), hi: Math.max(a[0], a[1]) });
    }
  });
  const out: Run[] = [];
  for (const h of [true, false]) {
    const segs = all.filter((s) => s.h === h).sort((a, b) => a.at - b.at);
    const lines: (typeof segs)[] = [];
    for (const s of segs) { const l = lines[lines.length - 1]; if (l && s.at - l[l.length - 1].at <= TOL_RUN) l.push(s); else lines.push([s]); }
    for (const l of lines) {
      let cur: typeof segs = [], hi = -Infinity;
      const flush = () => {
        const wires = [...new Set(cur.map((s) => s.w))];
        if (wires.length > 1) out.push({ wires, horizontal: h, at: cur[0].at, from: Math.min(...cur.map((s) => s.lo)), to: hi, segs: cur.map((s) => [s.w, s.s]) });
      };
      for (const s of l.sort((a, b) => a.lo - b.lo)) {
        if (cur.length && s.lo < hi - min) { cur.push(s); hi = Math.max(hi, s.hi); } else { flush(); cur = [s]; hi = s.hi; }
      }
      flush();
    }
  }
  return out;
}

/** Distinct wire pairs that share a run (the lint's `overlapWires`). */
export function overlapPairs(layout: { e: WireLayout["e"] }): number {
  const pairs = new Set<string>();
  for (const r of sharedRuns(layout)) for (const a of r.wires) for (const b of r.wires) if (a < b) pairs.add(`${a},${b}`);
  return pairs.size;
}

/** Wire crossings (as lint.ts counts them) and the "wire>box" pairs a wire passes through. */
function wireScore(layout: WireLayout): [number, Set<string>] {
  const w = layout.e.filter((x) => !x[2]).map(([a, z, , ...p]) => ({ a, z, s: p.reduce<Pt[]>((o, v, i) => (i % 2 ? (o[o.length - 1][1] = v, o) : [...o, [v, 0]]), []) }));
  const through = new Set<string>();
  for (const x of w) for (const [id, bx, by, bw, bh] of layout.n) {
    if (id !== x.a && id !== x.z && x.s.some((q, i) => i > 0 && segHitsRect(x.s[i - 1], q, { x: bx + 2, y: by + 2, w: bw - 4, h: bh - 4 }))) through.add(`${x.a}>${x.z}>${id}`);
  }
  let cross = 0;
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
    const A = w[i].s, B = w[j].s, ends = [A[0], A[A.length - 1], B[0], B[B.length - 1]], seen: Pt[] = [];
    for (let s = 1; s < A.length; s++) for (let t = 1; t < B.length; t++) {
      const x = segCross(A[s - 1], A[s], B[t - 1], B[t]);
      if (!x || ends.some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) < 8) || seen.some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) < 4)) continue;
      seen.push(x);
      cross++;
    }
  }
  return [cross, through];
}

/** A polyline without repeated points (as boxsize.ts bendsOnly; not imported, it imports this file). */
function dedupe(p: number[]): number[] {
  const out = p.slice(0, 2);
  for (let i = 2; i < p.length; i += 2) if (p[i] !== out[out.length - 2] || p[i + 1] !== out[out.length - 1]) out.push(p[i], p[i + 1]);
  return out.length >= 4 ? out : p;
}

/** Moves each run's wires onto parallel tracks `gap` apart (in place on `e`). A run whose end would leave its box's side is skipped. */
function spread(e: WireLayout["e"], runs: Run[], gap: number, box: Map<string, Rect>): void {
  for (const r of runs) {
    const c = r.horizontal ? 1 : 0, sign = (a: number, b: number) => Math.sign(a - b);
    const key = (w: number, s: number) => {
      const p = e[w].slice(3) as number[], m = p.length / 2 - 1, at = p[2 * s + c];
      return (s > 0 ? sign(p[2 * s - 2 + c], at) : 0) + (s < m - 1 ? sign(p[2 * s + 4 + c], at) : 0);
    };
    const order = [...r.segs].sort((x, y) => key(...x) - key(...y) || x[0] - y[0]);
    const moves = order.map(([w, s], i) => [w, s, Math.round((i - (order.length - 1) / 2) * gap)] as const);
    const fits = moves.every(([w, s, d]) => {
      const p = e[w].slice(3) as number[], m = p.length / 2 - 1, v = p[2 * s + c] + d;
      return ([[0, e[w][0]], [m - 1, e[w][1]]] as const).every(([end, id]) => {
        const b = box.get(id);
        return s !== end || !b || (v >= (c ? b.y : b.x) + 6 && v <= (c ? b.y + b.h : b.x + b.w) - 6);
      });
    });
    if (!fits) continue;
    for (const [w, s, d] of moves) {
      const q = e[w] as unknown as number[];
      q[3 + 2 * s + c] += d; q[5 + 2 * s + c] += d;
    }
  }
}

/**
 * Gives wires that run on top of each other their own parallel tracks (gap 10px, else 6). Only
 * wire segments move, never boxes. The result is kept only if it has fewer overlapping pairs, no
 * more crossings and no new wire through a box; otherwise the layout comes back unchanged.
 */
export function separateWires<L extends WireLayout>(layout: L, gap = 10): L {
  if (!sharedRuns(layout).length) return layout;
  const box = new Map(layout.n.map(([id, x, y, w, h]) => [id, { x, y, w, h }])), [c0, t0] = wireScore(layout), o0 = overlapPairs(layout);
  for (const g of [gap, 6]) {
    const e = layout.e.map((w) => [...w] as WireLayout["e"][number]);
    for (let i = 0; i < 3; i++) {
      const runs = sharedRuns({ e });
      if (!runs.length) break;
      spread(e, runs, g, box);
      e.forEach((w, k) => { if (!w[2]) e[k] = [w[0], w[1], 0, ...dedupe((w as unknown as number[]).slice(3))]; });
    }
    const next = { ...layout, e }, [c1, t1] = wireScore(next);
    if (overlapPairs(next) < o0 && c1 <= c0 && [...t1].every((t) => t0.has(t))) return next;
  }
  return layout;
}
