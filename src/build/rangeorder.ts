// Alphabetical ranges (model/budgetsplit.ts evenSplit) read in order (#241). ELK orders a layer's
// boxes to cut crossings, so zod's locales read "ar – cs", "fr – hy", "da – fi". Where ranges of
// one split share a layer (a column, or a row) and a size, they trade places into alphabetical order.
// A range's wire to a box takes the route the slot's old holder had to that same box, so the wires
// drawn stay as they were; a wire with no such route slides its last bend along its track.
import type { Model } from "../model/rollup.ts";
import type { BoardLayout } from "./layout.ts";
import { tidy } from "./storylayout.ts";
import { segCross, throughWires } from "./outline.ts";
import { samples } from "../viewer/labels.ts";

/** budgetsplit.ts ends every even range's summary this way. */
export const isRange = (model: Model, id: string) => !!model.nodes[id]?.summary?.endsWith(", split alphabetically.");

/** Length of a jog's first leg, outside the box (half the run when that is shorter). */
const JOG = 12;

type Edge = BoardLayout["e"][number];

const reversed = (p: number[]) => {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
};

/**
 * The wire with its end (or start) moved by `d` along `axis` (0 x, 1 y). Its last run must meet the
 * box on a side facing across the move. When the run before it is a track along the move, the bend
 * between them slides along that track; otherwise the wire takes a jog just outside the box.
 */
export function shift(e: Edge, end: boolean, axis: 0 | 1, d: number, others: readonly Edge[] = []): Edge | null {
  const [a, z, curve, ...p] = e;
  if (curve || p.length < 4) return null;
  const q = end ? [...p] : reversed(p), c = axis, o = 1 - axis;
  const L = q.length - 2, P = L - 2, B = L - 4;
  if (q[L + c] !== q[P + c]) return null;
  if (B >= 0 && q[B + o] === q[P + o]) {
    q[P + c] += d;
    q[L + c] += d;
    // a track another wire already runs along would read as one line: step it toward the box
    const step = Math.sign(q[L + o] - q[P + o]) * NUDGE;
    for (let i = 0; i < 3 && onTrack(others, o, q[P + o], q[B + c], q[P + c]) && Math.abs(q[L + o] - q[P + o]) > 2 * NUDGE; i++) {
      q[B + o] += step;
      q[P + o] += step;
    }
  } else {
    const run = q[L + o] - q[P + o], g = q[L + o] - Math.sign(run) * Math.min(JOG, Math.abs(run) / 2);
    const at = (along: number, across: number) => (axis === 1 ? [across, along] : [along, across]);
    q.splice(L, 2, ...at(q[L + c], g), ...at(q[L + c] + d, g), ...at(q[L + c] + d, q[L + o]));
  }
  const out = tidy(q);
  return [a, z, 0, ...(end ? out : reversed(out))];
}

const NUDGE = 8;

/** Whether some wire runs along the line where coordinate `o` is `t`, over part of [u0, u1] (coordinate 1 - o). */
function onTrack(edges: readonly Edge[], o: number, t: number, u0: number, u1: number): boolean {
  const [lo, hi] = u0 < u1 ? [u0, u1] : [u1, u0], c = 1 - o;
  return edges.some(([, , curve, ...p]) => {
    if (curve) return false;
    for (let i = 2; i + 1 < p.length; i += 2) {
      if (Math.abs(p[i - 2 + o] - t) > 1 || Math.abs(p[i + o] - t) > 1) continue;
      const [a, b] = p[i - 2 + c] < p[i + c] ? [p[i - 2 + c], p[i + c]] : [p[i + c], p[i - 2 + c]];
      if (Math.min(b, hi) - Math.max(a, lo) > 1) return true;
    }
    return false;
  });
}

/** One layer's ranges, given in their split's order, moved onto the layer's slots in reading order. */
function reorder(l: BoardLayout, ids: string[], axis: 0 | 1): BoardLayout | null {
  const at = (id: string) => l.n.find((r) => r[0] === id)![1 + axis] as number;
  const slots = ids.map(at).sort((p, q) => p - q);
  const move = new Map(ids.map((id, i) => [id, slots[i] - at(id)]));
  if ([...move.values()].every((d) => !d)) return null;
  // the box that held each range's new slot before
  const holder = new Map(ids.map((id, i) => [id, ids.find((h) => at(h) === slots[i])!]));
  const route = new Map(l.e.map((w) => [`${w[0]}>${w[1]}`, w]));
  const n = l.n.map((r) => {
    if (!move.get(r[0])) return r;
    const c = [...r] as typeof r;
    c[1 + axis] = (c[1 + axis] as number) + move.get(r[0])!;
    return c;
  });
  // first the wires that stay or take a holder's route, then the rest slide, clear of those
  const e: (Edge | null)[] = l.e.map((w) => {
    const [a, z] = w, da = move.get(a) ?? 0, dz = move.get(z) ?? 0;
    if (!da && !dz) return w;
    // a wire between a moved range and a box that stays: the holder's own wire to that box, if it had one
    const took = da && !move.has(z) ? route.get(`${holder.get(a)}>${z}`) : dz && !move.has(a) ? route.get(`${a}>${holder.get(z)}`) : undefined;
    return took ? [a, z, ...(took.slice(2) as [0 | 1, ...number[]])] : null;
  });
  for (let i = 0; i < e.length; i++) {
    if (e[i]) continue;
    const w = l.e[i], others = e.filter((x): x is Edge => !!x);
    let x: Edge | null = w;
    if (move.get(w[1])) x = shift(x, true, axis, move.get(w[1])!, others);
    if (x && move.get(w[0])) x = shift(x, false, axis, move.get(w[0])!, others);
    if (!x) return null;
    e[i] = x;
  }
  return { n, e: e as Edge[] };
}

/** Crossings an order may add: reading order is worth one, not a tangle (express's examples would add 4). */
const MAX_ADDED = 1;

/** Wire crossings on a layout, away from the wires' ends (where wires meeting at a box touch). */
export function crossings(l: BoardLayout): number {
  const ws = l.e.map(([, , curve, ...p]) => samples(curve, p));
  let k = 0;
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const A = ws[i], B = ws[j], ends = [A[0], A[A.length - 1], B[0], B[B.length - 1]];
    for (let s = 1; s < A.length; s++) for (let t = 1; t < B.length; t++) {
      const x = segCross(A[s - 1], A[s], B[t - 1], B[t]);
      if (x && !ends.some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) < 8)) k++;
    }
  }
  return k;
}

/**
 * Puts each split's ranges in alphabetical order where they share a column (by y) or a row (by x)
 * and a size. A reorder is kept only if no wire then crosses a box it didn't cross before, and it
 * adds at most MAX_ADDED wire crossings.
 */
export function orderRanges(model: Model, boardId: string, layout: BoardLayout): BoardLayout {
  const ranges = layout.n.filter((r) => isRange(model, r[0]));
  if (ranges.length < 2) return layout;
  const order = (id: string) => model.nodes[model.nodes[id].parent!]?.children.indexOf(id) ?? 0;
  let out = layout;
  for (const axis of [1, 0] as const) {
    const layers = new Map<string, string[]>();
    for (const r of ranges) {
      const k = `${model.nodes[r[0]].parent}|${r[2 - axis]}|${r[3]}x${r[4]}`;
      layers.set(k, [...(layers.get(k) ?? []), r[0]]);
    }
    for (const ids of [...layers.values()].filter((v) => v.length > 1)) {
      const next = reorder(out, ids.sort((p, q) => order(p) - order(q)), axis);
      if (!next) continue;
      const before = throughWires(model, boardId, out);
      if ([...throughWires(model, boardId, next)].every((w) => before.has(w)) && crossings(next) <= crossings(out) + MAX_ADDED) out = next;
    }
  }
  return out;
}
