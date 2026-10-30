// Our own layered layout, small on purpose: longest-path ranks become columns of one width, boxes sit
// on one grid of rows, and wires run orthogonally in channels between the columns. Built in the
// right-flowing frame; a down-flowing board is the same layout with x and y swapped.
import type { BoardLayout } from "../layout.ts";
import type { Graph } from "./graph.ts";

export interface ColumnOpts { dir: "right" | "down"; /** Space between columns and rows (px). */ hgap: number; vgap: number }

const TRACK = 10;

/** Ranks by longest path after breaking cycles depth-first in board order; returns the reversed edges too. */
export function ranks(n: number, edges: [number, number][]): { rank: number[]; back: boolean[] } {
  const out: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], i) => out[a].push(i));
  const state = new Array(n).fill(0), back = edges.map(() => false);
  const dfs = (v: number) => {
    state[v] = 1;
    for (const i of out[v]) { const w = edges[i][1]; if (state[w] === 1) back[i] = true; else if (!state[w]) dfs(w); }
    state[v] = 2;
  };
  for (let v = 0; v < n; v++) if (!state[v]) dfs(v);
  const dag = edges.map(([a, b], i): [number, number] => (back[i] ? [b, a] : [a, b])).filter(([a, b]) => a !== b);
  const rank = new Array(n).fill(0), indeg = new Array(n).fill(0);
  for (const [, b] of dag) indeg[b]++;
  const queue = [...Array(n).keys()].filter((v) => !indeg[v]), order: number[] = [];
  while (queue.length) {
    const v = queue.shift()!;
    order.push(v);
    for (const [a, b] of dag) if (a === v) { rank[b] = Math.max(rank[b], rank[v] + 1); if (!--indeg[b]) queue.push(b); }
  }
  // a source sits just before its nearest target rather than in the first column
  for (const v of [...order].reverse()) {
    if (dag.some(([, b]) => b === v)) continue;
    const t = dag.filter(([a]) => a === v).map(([, b]) => rank[b]);
    if (t.length) rank[v] = Math.min(...t) - 1;
  }
  return { rank, back };
}

/** Rows within each column: a few barycenter sweeps, then each box takes the free row nearest its wish. */
function rows(n: number, rank: number[], dag: [number, number][]): number[] {
  const cols = Math.max(0, ...rank) + 1, by: number[][] = Array.from({ length: cols }, () => []);
  for (let v = 0; v < n; v++) by[rank[v]].push(v);
  const row = new Array(n).fill(0);
  for (const L of by) L.forEach((v, i) => (row[v] = i - Math.floor((L.length - 1) / 2)));
  const nb = (v: number, before: boolean) => dag.flatMap(([a, b]) => (a === v ? [b] : b === v ? [a] : [])).filter((w) => (before ? rank[w] < rank[v] : rank[w] > rank[v]));
  const sweep = (c: number, before: boolean) => {
    const want = new Map(by[c].map((v) => { const w = nb(v, before); return [v, w.length ? w.reduce((s, x) => s + row[x], 0) / w.length : row[v]]; }));
    const L = [...by[c]].sort((a, b) => want.get(a)! - want.get(b)! || row[a] - row[b] || a - b);
    let prev = -Infinity;
    const placed = L.map((v) => (prev = Math.max(prev + 1, Math.round(want.get(v)!))));
    // packing only pushes down; shift back so the column sits around its wishes
    const shift = Math.round(L.reduce((s, v, i) => s + want.get(v)! - placed[i], 0) / L.length);
    L.forEach((v, i) => (row[v] = placed[i] + shift));
    by[c] = L;
  };
  for (let it = 0; it < 3; it++) {
    for (let c = 1; c < cols; c++) sweep(c, true);
    for (let c = cols - 2; c >= 0; c--) sweep(c, false);
  }
  // rows no box uses (left by the shifts) would only add empty bands
  const used = [...new Set(row)].sort((a, b) => a - b);
  return row.map((r) => used.indexOf(r));
}

/**
 * Left-to-right order of the vertical jogs in one channel, each on its own track. A wire enters its jog
 * from the left at y0 and leaves to the right at y1, so with A left of B they cross when B's entry
 * passes A's jog or A's exit passes B's. Each jog is inserted where it adds the fewest crossings.
 */
export function jogOrder(jogs: { y0: number; y1: number }[]): number[] {
  const within = (y: number, a: number, b: number) => y > Math.min(a, b) + 0.5 && y < Math.max(a, b) - 0.5;
  const cost = (A: { y0: number; y1: number }, B: { y0: number; y1: number }) => +within(B.y0, A.y0, A.y1) + +within(A.y1, B.y0, B.y1);
  const order: number[] = [];
  for (let i = 0; i < jogs.length; i++) {
    let best = 0, bestC = Infinity;
    for (let at = 0; at <= order.length; at++) {
      const c = order.reduce((s, j, k) => s + (k < at ? cost(jogs[j], jogs[i]) : cost(jogs[i], jogs[j])), 0);
      if (c < bestC) [best, bestC] = [at, c];
    }
    order.splice(best, 0, i);
  }
  const track = new Array(jogs.length).fill(0);
  order.forEach((j, k) => (track[j] = k));
  return track;
}

/** Greedy interval colouring: the track index of each [lo, hi] span, sharing tracks only when apart. */
function tracks(spans: [number, number][]): number[] {
  const ends: number[] = [], out = new Array(spans.length).fill(0);
  [...spans.keys()].sort((a, b) => spans[a][0] - spans[b][0] || spans[a][1] - spans[b][1] || a - b).forEach((i) => {
    let t = ends.findIndex((e) => e < spans[i][0] - 4);
    if (t < 0) t = ends.push(0) - 1;
    ends[t] = spans[i][1];
    out[i] = t;
  });
  return out;
}

export function columnLayout(g: Graph, o: ColumnOpts): BoardLayout {
  const down = o.dir === "down";
  // in the right-flowing frame a down board's boxes are turned: width along the flow is their height
  const W = g.nodes.map((n) => (down ? n.h : n.w)), H = g.nodes.map((n) => (down ? n.w : n.h));
  const [hgap, vgap] = down ? [o.vgap, o.hgap] : [o.hgap, o.vgap];
  const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
  const E = g.edges.map((e): [number, number] => [idx.get(e.a)!, idx.get(e.b)!]);
  const { rank, back } = ranks(g.nodes.length, E);
  const dag = E.map(([a, b], i): [number, number] => (back[i] ? [b, a] : [a, b]));
  const row = rows(g.nodes.length, rank, dag.filter(([a, b]) => a !== b));
  const cols = Math.max(0, ...rank) + 1, rowH = Math.max(...H) + vgap;
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...W.filter((_, v) => rank[v] === c)));
  const top = (v: number) => row[v] * rowH + (rowH - vgap - H[v]) / 2;
  const free = (y: number, c0: number, c1: number) => g.nodes.every((_, v) => rank[v] <= c0 || rank[v] >= c1 || y < top(v) - 6 || y > top(v) + H[v] + 6);

  // ports: wires leave a box's right side and enter its left side, spread in the order of the far ends
  const portY = new Map<string, number>();
  for (let v = 0; v < g.nodes.length; v++) for (const side of ["o", "i"] as const) {
    const mine = dag.flatMap(([a, b], i) => ((side === "o" ? a : b) === v && a !== b ? [i] : []));
    const far = (i: number) => { const w = side === "o" ? dag[i][1] : dag[i][0]; return row[w] * 1000 + rank[w]; };
    mine.sort((x, y) => far(x) - far(y) || x - y);
    const step = Math.min(12, (H[v] * 0.6) / Math.max(1, mine.length - 1));
    mine.forEach((i, k) => portY.set(`${side}${i}`, top(v) + H[v] / 2 + (k - (mine.length - 1) / 2) * step));
  }

  // each wire as [horizontal run y, vertical jog in channel c (x unknown yet)], first in y alone
  type Jog = { c: number; y0: number; y1: number; t?: number };
  const plan = dag.map(([s, t], i) => {
    if (s === t) return null;
    const ys = portY.get(`o${i}`)!, yt = portY.get(`i${i}`)!, cs = rank[s], ct = rank[t];
    if (ct === cs + 1 || Math.abs(ys - yt) < 0.5 && free(ys, cs, ct)) return { ys, yt, jogs: ys === yt ? [] : [{ c: cs, y0: ys, y1: yt }] as Jog[] };
    if (free(yt, cs, ct)) return { ys, yt, jogs: [{ c: cs, y0: ys, y1: yt }] };
    if (free(ys, cs, ct)) return { ys, yt, jogs: [{ c: ct - 1, y0: ys, y1: yt }] };
    // along the gap between two rows nearest the target; the gap's own tracks are set below
    const k = Math.max(0, Math.round((yt + vgap / 2) / rowH));
    return { ys, yt, k, jogs: [{ c: cs, y0: ys, y1: NaN }, { c: ct - 1, y0: NaN, y1: yt }] as Jog[] };
  });
  // wires sharing a gap over overlapping columns get their own lines in it
  const gaps = new Map<number, number[]>();
  plan.forEach((p, i) => { if (p && "k" in p) gaps.set(p.k!, [...(gaps.get(p.k!) ?? []), i]); });
  for (const [k, is] of gaps) {
    const t = tracks(is.map((i) => [rank[dag[i][0]], rank[dag[i][1]] - 1])), n = Math.max(...t) + 1;
    const pitch = Math.min(8, (vgap - 8) / Math.max(1, n));
    is.forEach((i, m) => { const yg = k * rowH - vgap / 2 + (t[m] - (n - 1) / 2) * pitch; plan[i]!.jogs[0].y1 = yg; plan[i]!.jogs[1].y0 = yg; });
  }
  const perChan = new Map<number, Jog[]>();
  for (const p of plan) for (const j of p?.jogs ?? []) perChan.set(j.c, [...(perChan.get(j.c) ?? []), j]);
  const chanW: number[] = [];
  for (let c = 0; c < cols; c++) {
    const js = perChan.get(c) ?? [], t = jogOrder(js);
    js.forEach((j, i) => (j.t = t[i]));
    chanW[c] = Math.max(hgap, (js.length + 1) * TRACK);
  }
  const colX: number[] = [];
  for (let c = 0, x = 0; c < cols; x += colW[c] + chanW[c], c++) colX.push(x);
  const left = (v: number) => colX[rank[v]] + (colW[rank[v]] - W[v]) / 2;
  const trackX = (j: Jog) => {
    const n = Math.max(0, ...(perChan.get(j.c) ?? []).map((k) => k.t!)) + 1, x0 = colX[j.c] + colW[j.c];
    return x0 + chanW[j.c] / 2 + (j.t! - (n - 1) / 2) * TRACK;
  };

  const R = (v: number) => Math.round(v * 10) / 10;
  const flip = (p: number[]) => (down ? p.flatMap((_, i) => (i % 2 ? [] : [p[i + 1], p[i]])) : p);
  const e = dag.flatMap(([s, t], i): BoardLayout["e"] => {
    const p = plan[i];
    if (!p) return [];
    const pts = [left(s) + W[s], p.ys];
    let y = p.ys;
    for (const j of p.jogs) { const x = trackX(j); pts.push(x, y, x, j.y1); y = j.y1; }
    pts.push(left(t), p.yt);
    const fwd = back[i] ? pts.flatMap((_, k) => (k % 2 ? [] : [pts[pts.length - 2 - k], pts[pts.length - 1 - k]])) : pts;
    return [[g.edges[i].a, g.edges[i].b, 0, ...flip(fwd).map(R)]];
  });
  const n = g.nodes.map((nd, v): BoardLayout["n"][number] => {
    const [x, y] = [R(left(v)), R(top(v))];
    return down ? [nd.id, y, x, nd.w, nd.h, nd.cyl] : [nd.id, x, y, nd.w, nd.h, nd.cyl];
  });
  return { n, e };
}
