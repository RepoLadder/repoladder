// Where the story level's "what they do" pills go. Each pill sits on a straight run of its own arrow,
// with line showing on both sides so the arrow visibly runs into and out of it, and clear of every
// box, every other pill and every other wire (a pill is drawn above the wires, so a wire under it
// would vanish). Among clean spots the one nearest the actor wins, which lines the pills up beside
// the actor column. Pure geometry, unit-tested directly.
import { overlap, samples, type Placed, type Rect } from "./labels.ts";

export interface Wire { curve: 0 | 1; p: number[] }
export interface Pill { wire: number; w: number; h: number }

/** Line left showing between a pill and the actor it leaves, the arrowhead it ends in, or a bend. */
export const PILL_START = 18;
const END = 26, BEND = 14, STEP = 6, PAD = 6;

/** Does segment a→b cross or touch rect r? (Liang–Barsky clipping.) */
export function segmentHits(r: Rect, a: [number, number], b: [number, number]): boolean {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const sides: [number, number][] = [[-dx, a[0] - r.x], [dx, r.x + r.w - a[0]], [-dy, a[1] - r.y], [dy, r.y + r.h - a[1]]];
  for (const [p, q] of sides) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return t0 <= t1;
}

/** Spots along a wire's straight runs where a w×h pill fits with line showing on both sides, nearest the start first. */
export function spots(wire: Wire, w: number, h: number): { x: number; y: number; along: number; vertical: boolean }[] {
  const pts = samples(wire.curve, wire.p), out: { x: number; y: number; along: number; vertical: boolean }[] = [];
  let along = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay);
    const vertical = Math.abs(bx - ax) < Math.abs(by - ay), size = vertical ? h : w;
    const lo = (i === 1 ? PILL_START : BEND) + size / 2, hi = len - (i === pts.length - 1 ? END : BEND) - size / 2;
    for (let d = lo; d <= hi; d += STEP) {
      const t = d / len;
      out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, along: along + d, vertical });
    }
    along += len;
  }
  return out;
}

/** Places every pill, in input order (deterministic). Pills that find no clean spot take the least crowded one. */
export function placePills(boxes: Rect[], wires: Wire[], pills: Pill[]): Placed[] {
  const lines = wires.map((w) => samples(w.curve, w.p));
  const taken: Rect[] = [];
  return pills.map((pill) => {
    const wire = wires[pill.wire];
    let cands = spots(wire, pill.w, pill.h);
    // no straight run is long enough: fall back to the middle of the longest one
    if (!cands.length) {
      const pts = lines[pill.wire];
      let best = 1;
      for (let i = 2; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > Math.hypot(pts[best][0] - pts[best - 1][0], pts[best][1] - pts[best - 1][1])) best = i;
      cands = [{ x: (pts[best][0] + pts[best - 1][0]) / 2, y: (pts[best][1] + pts[best - 1][1]) / 2, along: 0, vertical: false }];
    }
    let pick: { x: number; y: number; cost: number } | null = null;
    for (const c of cands) {
      const r = { x: c.x - pill.w / 2, y: c.y - pill.h / 2, w: pill.w, h: pill.h };
      let cost = c.along * 0.05 + (c.vertical ? 200 : 0);
      for (const b of boxes) cost += overlap(r, b, PAD) * 50;
      for (const t of taken) cost += overlap(r, t, 2) * 50;
      const g = { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 };
      lines.forEach((pts, i) => {
        if (i === pill.wire) return;
        for (let k = 1; k < pts.length; k++) if (segmentHits(g, pts[k - 1], pts[k])) { cost += 5000; break; }
      });
      if (!pick || cost < pick.cost) pick = { x: c.x, y: c.y, cost };
    }
    taken.push({ x: pick!.x - pill.w / 2, y: pick!.y - pill.h / 2, w: pill.w, h: pill.h });
    return { x: Math.round(pick!.x * 10) / 10, y: Math.round(pick!.y * 10) / 10, lo: pick!.cost >= 5000 };
  });
}
