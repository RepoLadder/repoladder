// Arrows of a store board's selection (a part's reads and writes, or a collection's readers and
// writers). The board is a lattice of same-size cells with gutters between them
// (build/storelayout.ts), so each arrow runs at right angles through the gutters instead of cutting
// across collection boxes: out of the part's right side into the gap beside it, then either straight
// into the collection's left side or along the row gap above (or below) it and into its top (or bottom).
import { simplify } from "./curves.ts";
import type { Rect } from "./xwire.ts";

type Pt = [number, number];

export const contains = (o: Rect, r: Rect) => o !== r && o[0] <= r[0] && o[1] <= r[1] && o[0] + o[2] >= r[0] + r[2] && o[1] + o[3] >= r[1] + r[3];

/** Whether the axis-aligned segment p→q runs through the inside of r (touching its border does not count). */
export function crosses(p: Pt, q: Pt, [x, y, w, h]: Rect): boolean {
  const lx = Math.min(p[0], q[0]), hx = Math.max(p[0], q[0]), ly = Math.min(p[1], q[1]), hy = Math.max(p[1], q[1]);
  return hx > x + 1 && lx < x + w - 1 && hy > y + 1 && ly < y + h - 1;
}

/**
 * The route from part `a` to collection `b` as a polyline, avoiding the `others` (every other box on
 * the board; frames holding `b` are let through). Candidates are scored on boxes crossed, then frames
 * crossed, then bends and length; the first of equals wins, so the route is deterministic.
 */
export function storeRoute(a: Rect, b: Rect, others: Rect[]): number[] {
  const hold = others.filter((r) => contains(r, b));
  const rest = others.filter((r) => !hold.includes(r));
  const frames = rest.filter((r) => rest.some((o) => contains(r, o)));
  const boxes = rest.filter((r) => !frames.includes(r));
  const sx = a[0] + a[2], sy = Math.round(a[1] + a[3] / 2);
  // the gap right of the part: halfway to the nearest box beside it (the next part column, or the collections)
  const beside = [...others, b].filter((r) => r[0] >= sx && r[1] < a[1] + a[3] && r[1] + r[3] > a[1]);
  const cx = Math.round(beside.length ? (sx + Math.min(...beside.map((r) => r[0]))) / 2 : sx + 14);
  // a frame's own name is on its first row; a plain box's in its middle
  const ty = Math.round(b[3] > 60 ? b[1] + 26 : b[1] + b[3] / 2), ex = Math.round(b[0] + b[2] / 2);
  // the row gap above (or below) the collection, between whatever its run passes: a run squeezed
  // past a frame's border costs more than going round the other side
  const lx = Math.min(cx, ex), hx = Math.max(cx, ex);
  const span = rest.filter((r) => r[0] < hx && r[0] + r[2] > lx);
  const above = span.filter((r) => r[1] + r[3] <= b[1] + 0.5).map((r) => r[1] + r[3]);
  const below = span.filter((r) => r[1] >= b[1] + b[3] - 0.5).map((r) => r[1]);
  const upGap = above.length ? b[1] - Math.max(...above) : 22, downGap = below.length ? Math.min(...below) - b[1] - b[3] : 22;
  const up = Math.round(b[1] - upGap / 2), down = Math.round(b[1] + b[3] + downGap / 2);
  const cands: [Pt[], number][] = [
    [[[sx, sy], [cx, sy], [cx, ty], [b[0], ty]], 0],
    [[[sx, sy], [cx, sy], [cx, up], [ex, up], [ex, b[1]]], Math.max(0, 16 - upGap) * 8],
    [[[sx, sy], [cx, sy], [cx, down], [ex, down], [ex, b[1] + b[3]]], Math.max(0, 16 - downGap) * 8],
  ];
  let best: { cost: number; pts: Pt[] } | null = null;
  for (const [c, tight] of cands) {
    const pts = simplify(c);
    let cost = tight + (pts.length - 2) * 15;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      cost += (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1])) / 20;
      cost += boxes.filter((r) => crosses(p, q, r)).length * 1000 + frames.filter((r) => crosses(p, q, r)).length * 50;
    }
    if (!best || cost < best.cost) best = { cost, pts };
  }
  return best!.pts.flat();
}
