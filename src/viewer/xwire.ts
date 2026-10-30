// Geometry for edges D2 never routed (revealed by a filter toggle, a focus or a tour step): one
// quadratic curve between two boxes, bent to whichever side crosses no other box, or, when every
// curve crosses one, an orthogonal route along the gutters (gutters.ts). Frames holding an end are no obstacle.
import { labelAt, roundPath } from "./curves.ts";
import { routeGutters, type Rect as GRect } from "./gutters.ts";
import { contains, crosses } from "./storewire.ts";

export type Rect = [x: number, y: number, w: number, h: number];

/** Where the segment from a rect's center towards (tx, ty) leaves the rect. */
function exit([x, y, w, h]: Rect, tx: number, ty: number): [number, number] {
  const cx = x + w / 2, cy = y + h / 2, dx = tx - cx, dy = ty - cy;
  const k = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

const inside = ([x, y, w, h]: Rect, px: number, py: number, pad = 6) => px > x - pad && px < x + w + pad && py > y - pad && py < y + h + pad;

// Relative bends tried in order; the sign flips with direction, so a→b and b→a start on opposite sides.
const BENDS = [0.12, -0.12, 0.3, -0.3, 0.55, -0.55];

/** `stack`: the cards drawn behind an openable target (shapes.ts STACK), so the arrowhead lands on them, not under them. */
export function extraPath(a: Rect, b: Rect, others: Rect[], stack = 0): { d: string; lx: number; ly: number } {
  others = others.filter((r) => !contains(r, a) && !contains(r, b));
  const to: Rect = [b[0], b[1], b[2] + stack, b[3] + stack];
  const ax = a[0] + a[2] / 2, ay = a[1] + a[3] / 2, bx = b[0] + b[2] / 2, by = b[1] + b[3] / 2;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let best: { cost: number; pts: number[] } | null = null;
  for (const k of BENDS) {
    const bow = Math.sign(k) * Math.min(Math.abs(k) * len, Math.abs(k) * 400);
    const mx = (ax + bx) / 2 + ((by - ay) / len) * bow, my = (ay + by) / 2 - ((bx - ax) / len) * bow;
    const [x0, y0] = exit(a, mx, my), [x1, y1] = exit(to, mx, my);
    let cost = 0;
    for (let i = 1; i < 48; i++) {
      const t = i / 48, u = 1 - t;
      const px = u * u * x0 + 2 * u * t * mx + t * t * x1, py = u * u * y0 + 2 * u * t * my + t * t * y1;
      if (others.some((r) => inside(r, px, py))) cost++;
    }
    if (!best || cost < best.cost) best = { cost, pts: [x0, y0, mx, my, x1, y1] };
    if (!cost) break;
  }
  if (best!.cost) {
    // the router sees only the boxes near the ends (Dijkstra stays cheap); its route is checked against all of them,
    // so one that strays onto a box further out is never drawn
    const R = ([x, y, w, h]: Rect) => ({ x, y, w, h }), box: Record<string, GRect> = { a: R(a), b: R(to) };
    // near: within 260 of the span between the two centers
    others.forEach((o, i) => { if (crosses([ax, ay], [bx, by], [o[0] - 260, o[1] - 260, o[2] + 520, o[3] + 520])) box[i] = R(o); });
    for (const m of [16, 8]) {
      const r = routeGutters(box, [["a", "b"]], m)[0];
      let ok = r.length > 3;
      for (let i = 2; i < r.length; i += 2) ok &&= !others.some((o) => crosses([r[i - 2], r[i - 1]], [r[i], r[i + 1]], o));
      if (ok) { const [lx, ly] = labelAt(r).map(Math.round); return { d: roundPath(r, 8), lx, ly }; }
    }
  }
  const [x0, y0, mx, my, x1, y1] = best!.pts.map(Math.round);
  return { d: `M${x0} ${y0}Q${mx} ${my} ${x1} ${y1}`, lx: Math.round((x0 + 2 * mx + x1) / 4), ly: Math.round((y0 + 2 * my + y1) / 4) };
}

/**
 * Where to put a box that is not on the board (a service "used throughout") so an arrow can reach
 * it from `near`: just outside `bounds`, beside `near`, on whichever side keeps the grown board
 * biggest in a canvas of the given aspect (width / height); ties go to the closer side.
 */
export function besideBoard(bounds: Rect, near: Rect, w: number, h: number, aspect: number, gap = 56): Rect {
  const [X, Y, W, H] = bounds, cx = near[0] + near[2] / 2, cy = near[1] + near[3] / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const ty = clamp(cy - h / 2, Y, Y + H - h), tx = clamp(cx - w / 2, X, X + W - w);
  const sides: { r: Rect; dist: number }[] = [
    { r: [X + W + gap, ty, w, h], dist: X + W - cx },
    { r: [X - gap - w, ty, w, h], dist: cx - X },
    { r: [tx, Y + H + gap, w, h], dist: Y + H - cy },
    { r: [tx, Y - gap - h, w, h], dist: cy - Y },
  ];
  // the scale the whole board (with the new box) fits at, in board units per canvas height
  const fitScale = ([x, y, bw, bh]: Rect) => {
    const uw = Math.max(X + W, x + bw) - Math.min(X, x), uh = Math.max(Y + H, y + bh) - Math.min(Y, y);
    return Math.min(aspect / uw, 1 / uh);
  };
  const best = sides.map((s) => ({ ...s, k: fitScale(s.r) })).sort((a, b) => b.k - a.k || a.dist - b.dist)[0];
  return best.r.map(Math.round) as Rect;
}
