// Edge-label placement: each label slides along its own wire to the first spot that clears every
// box and every label placed before it. Labels that find no free spot are marked `lo` and only
// show when zoomed in or when their wire is lit (focus.ts), so the default view never overlaps.
// Pure geometry (no DOM), so it is unit-tested directly.

export interface Rect { x: number; y: number; w: number; h: number }
export interface LabelItem {
  /** The wire as [curve, flat points] from the layout. */
  curve: 0 | 1;
  p: number[];
  w: number;
  h: number;
  /** Higher places first and so gets the best spot. */
  prio: number;
}
export interface Placed { x: number; y: number; lo: boolean }

/** Tried in order: the middle of the wire first, then outward. */
const FRACTIONS = [0.5, 0.43, 0.57, 0.36, 0.64, 0.29, 0.71, 0.22, 0.78, 0.16, 0.84];
const BOX_PAD = 4, GAP = 4;

/** Dense samples along the wire (polyline, or a start point followed by cubic Bézier triples). */
export function samples(curve: 0 | 1, p: number[]): [number, number][] {
  const pts: [number, number][] = [[p[0], p[1]]];
  if (!curve) {
    for (let i = 2; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
    return pts;
  }
  for (let i = 2; i + 5 < p.length; i += 6) {
    const [x0, y0] = pts[pts.length - 1], [x1, y1, x2, y2, x3, y3] = p.slice(i, i + 6);
    for (let k = 1; k <= 16; k++) {
      const t = k / 16, u = 1 - t;
      pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
  }
  return pts;
}

/** The point at fraction f of the polyline's length. */
export function pointAt(pts: [number, number][], f: number): [number, number] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
  let left = total * f;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, left / seg[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    left -= seg[i];
  }
  return pts[0];
}

/** Overlap area of two rects after growing `a` by pad on every side. */
export function overlap(a: Rect, b: Rect, pad = 0): number {
  const w = Math.min(a.x + a.w + pad, b.x + b.w) - Math.max(a.x - pad, b.x);
  const h = Math.min(a.y + a.h + pad, b.y + b.h) - Math.max(a.y - pad, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Places every label; the result is in input order. Ties in prio keep input order, so output is deterministic. */
export function placeLabels(boxes: Rect[], items: LabelItem[]): Placed[] {
  const out: Placed[] = new Array(items.length);
  const taken: Rect[] = [];
  const order = items.map((_, i) => i).sort((a, b) => items[b].prio - items[a].prio || a - b);
  for (const i of order) {
    const it = items[i], pts = samples(it.curve, it.p);
    let best: { at: [number, number]; cost: number } | null = null;
    for (const f of FRACTIONS) {
      const at = pointAt(pts, f), r = { x: at[0] - it.w / 2, y: at[1] - it.h / 2, w: it.w, h: it.h };
      let cost = 0;
      for (const b of boxes) cost += overlap(r, b, BOX_PAD) * 4;
      for (const t of taken) cost += overlap(r, t, GAP);
      if (!best || cost < best.cost) best = { at, cost };
      if (!cost) break;
    }
    const lo = best!.cost > 0;
    // A label that collides anyway doesn't reserve its spot, so it never pushes a clean one aside.
    if (!lo) taken.push({ x: best!.at[0] - it.w / 2, y: best!.at[1] - it.h / 2, w: it.w, h: it.h });
    out[i] = { x: Math.round(best!.at[0] * 10) / 10, y: Math.round(best!.at[1] * 10) / 10, lo };
  }
  return out;
}

/** Size of a store verb's pill (draw.ts draws it, build/lint.ts measures it). */
export const pillSize = (t: string): [number, number] => [t.length * 7 + 12, 18];

/** Which labels get the best spots: busier data arrows first, then story verbs; edges into a hub last. */
export function labelPrio(e: { reads?: number; writes?: number; hub?: true }): number {
  return e.hub ? -1 : (e.reads ?? 0) + (e.writes ?? 0);
}
