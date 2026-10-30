// Orthogonal wires between packed boxes (Everything's group containers, everylayout.ts). ELK's
// rectpacking places boxes but routes nothing, so each wire takes the cheapest path along the
// gutters between them (length, plus a cost per bend and per gutter stretch another wire already
// took), from a side of one box to a side of the other. Wires that still share a stretch are then
// spread across the gutter, so every line can be traced on its own. Pure.

import { simplify } from "./curves.ts";

export interface Rect { x: number; y: number; w: number; h: number }

const BEND = 60, SHARED = 80, STEP = 6;

/**
 * One polyline ([x, y, x, y, …]) per edge, from the border of `a` to the border of `b`. `m` is
 * half the gap between boxes: the gutter's middle, where wires run, is `m` from every box.
 */
export function routeGutters(box: Record<string, Rect>, edges: [string, string][], m: number): number[][] {
  const rs = Object.values(box);
  if (!edges.length || !rs.length) return edges.map(() => []);
  const solid = (x: number, y: number) => rs.some((r) => x > r.x - m + 0.5 && x < r.x + r.w + m - 0.5 && y > r.y - m + 0.5 && y < r.y + r.h + m - 0.5);
  const xs = new Set<number>(), ys = new Set<number>();
  for (const r of rs) {
    xs.add(r.x - m).add(r.x + r.w + m).add(r.x + r.w / 2);
    ys.add(r.y - m).add(r.y + r.h + m).add(r.y + r.h / 2);
  }
  // grid points in the gutters, and the four side middles of every box (the ports)
  const pts: [number, number][] = [], at = new Map<string, number>();
  const add = (x: number, y: number) => { const k = `${x},${y}`; if (!at.has(k)) { at.set(k, pts.length); pts.push([x, y]); } return at.get(k)!; };
  for (const x of xs) for (const y of ys) if (!solid(x, y)) add(x, y);
  const nb: [number, number, number][][] = []; // [to, dir, length]
  const link = (p: number, q: number, d: number) => {
    const l = Math.abs(pts[p][0] - pts[q][0]) + Math.abs(pts[p][1] - pts[q][1]);
    (nb[p] ??= []).push([q, d, l]);
    (nb[q] ??= []).push([p, (d + 2) % 4, l]);
  };
  // dirs: 0 right, 1 down, 2 left, 3 up
  const clear = (x1: number, y1: number, x2: number, y2: number, among = rs) => !among.some((r) => Math.min(x1, x2) < r.x + r.w - 0.5 && Math.max(x1, x2) > r.x + 0.5 && Math.min(y1, y2) < r.y + r.h - 0.5 && Math.max(y1, y2) > r.y + 0.5);
  const lines = (vert: boolean) => {
    const by = new Map<number, number[]>();
    pts.forEach(([x, y], i) => { const k = vert ? x : y; by.set(k, [...(by.get(k) ?? []), i]); });
    for (const ids of by.values()) {
      ids.sort((p, q) => (vert ? pts[p][1] - pts[q][1] : pts[p][0] - pts[q][0]));
      for (let i = 1; i < ids.length; i++) {
        const [x1, y1] = pts[ids[i - 1]], [x2, y2] = pts[ids[i]];
        if (clear(x1, y1, x2, y2)) link(ids[i - 1], ids[i], vert ? 1 : 0);
      }
    }
  };
  lines(true);
  lines(false);
  const ports = new Map<string, [number, number][]>(); // box -> [port point, its outward dir]
  for (const [id, r] of Object.entries(box)) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const sides: [number, number, number, number, number][] = [[r.x + r.w, cy, r.x + r.w + m, cy, 0], [cx, r.y + r.h, cx, r.y + r.h + m, 1], [r.x, cy, r.x - m, cy, 2], [cx, r.y, cx, r.y - m, 3]];
    ports.set(id, sides.flatMap(([px, py, gx, gy, d]) => {
      const g = at.get(`${gx},${gy}`);
      if (g === undefined) return [];
      const p = add(px, py);
      link(p, g, d);
      return [[p, d] as [number, number]];
    }));
  }
  const used = new Map<string, number>();
  const segKey = (p: number, q: number) => (p < q ? `${p}-${q}` : `${q}-${p}`);
  const routes = edges.map(([a, b]) => {
    const path = cheapest(ports.get(a) ?? [], new Set((ports.get(b) ?? []).map(([p]) => p)), nb, (p, q) => (used.get(segKey(p, q)) ?? 0) * SHARED);
    for (let i = 1; i < path.length; i++) used.set(segKey(path[i - 1], path[i]), (used.get(segKey(path[i - 1], path[i])) ?? 0) + 1);
    return simplify(path.map((i) => [...pts[i]] as [number, number]));
  });
  const plain = routes.map((r) => r.map((p) => [...p] as [number, number]));
  spread(routes, m);
  return routes.map((r0, i) => {
    // spreading can close up a short stretch: drop the points it left doubled or in line
    const r = simplify(r0.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
    // and, rarely, push a wire onto a box it ran beside: that wire keeps the gutter's middle
    const others = rs.filter((q) => q !== box[edges[i][0]] && q !== box[edges[i][1]]);
    const hits = r.some((p, j) => j && !clear(r[j - 1][0], r[j - 1][1], p[0], p[1], others));
    return (hits ? plain[i] : r).flat();
  });
}

/** Dijkstra over (point, heading), from any port of the start box to any port of the end box. */
function cheapest(from: [number, number][], to: Set<number>, nb: [number, number, number][][], extra: (p: number, q: number) => number): number[] {
  const best = new Map<number, number>(), prev = new Map<number, number>();
  const heap: [number, number][] = []; // [cost, state = point * 4 + dir]
  const push = (c: number, s: number, from: number) => {
    if ((best.get(s) ?? Infinity) <= c) return;
    best.set(s, c);
    prev.set(s, from);
    heap.push([c, s]);
    for (let i = heap.length - 1; i > 0;) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let k = i; if (l < heap.length && heap[l][0] < heap[k][0]) k = l; if (r < heap.length && heap[r][0] < heap[k][0]) k = r; if (k === i) break; [heap[i], heap[k]] = [heap[k], heap[i]]; i = k; }
    }
    return top;
  };
  for (const [p, d] of from) push(0, p * 4 + d, -1);
  while (heap.length) {
    const [c, s] = pop();
    if (c > (best.get(s) ?? Infinity)) continue;
    const p = s >> 2, d = s & 3;
    if (to.has(p) && prev.get(s) !== -1) {
      const out: number[] = [];
      for (let x = s; x !== -1; x = prev.get(x)!) out.unshift(x >> 2);
      return out;
    }
    for (const [q, nd, l] of nb[p] ?? []) {
      if (nd === (d + 2) % 4) continue;
      push(c + l + (nd === d ? 0 : BEND) + extra(p, q), q * 4 + nd, s);
    }
  }
  return [];
}

/** Wires running along the same stretch of gutter are moved apart, centred on its middle. */
function spread(routes: [number, number][][], m: number): void {
  const segs = new Map<string, [number, number, number, number][]>(); // line -> [route, seg, lo, hi]
  routes.forEach((r, ri) => {
    for (let i = 0; i + 1 < r.length; i++) {
      const h = r[i][1] === r[i + 1][1], c = h ? r[i][1] : r[i][0];
      const lo = Math.min(h ? r[i][0] : r[i][1], h ? r[i + 1][0] : r[i + 1][1]), hi = Math.max(h ? r[i][0] : r[i][1], h ? r[i + 1][0] : r[i + 1][1]);
      const k = `${h ? "h" : "v"}${c}`;
      segs.set(k, [...(segs.get(k) ?? []), [ri, i, lo, hi]]);
    }
  });
  const moves: [number, number, number, boolean][] = [];
  for (const [k, ss] of segs) {
    ss.sort((x, y) => x[2] - y[2]);
    let cl: typeof ss = [], hi = -Infinity;
    const flush = () => {
      if (new Set(cl.map((s) => s[0])).size > 1) {
        const step = Math.min(STEP, (2 * (m - 3)) / (cl.length - 1));
        cl.sort((x, y) => x[0] - y[0]).forEach((s, j) => moves.push([s[0], s[1], (j - (cl.length - 1) / 2) * step, k[0] === "h"]));
      }
      cl = [];
    };
    for (const s of ss) { if (s[2] >= hi - 0.5) flush(), (hi = -Infinity); cl.push(s); hi = Math.max(hi, s[3]); }
    flush();
  }
  for (const [ri, i, d, h] of moves) for (const p of [routes[ri][i], routes[ri][i + 1]]) p[h ? 1 : 0] += d;
}
