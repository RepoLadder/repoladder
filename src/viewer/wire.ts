// The page data's wire format: what build/filepack.ts deflates, and what unpack.ts turns back
// into ViewerData. Lossless; it only reshapes the bulkiest tables so deflate finds more repeats:
// - each board's edges travel as columns (all `a`s, then all `b`s, all import counts, …), since a
//   column of small similar values compresses far better than objects with repeated keys;
// - box ids on a board (edge ends, layout boxes and wires, flow steps) are indexes into that
//   board's `nodes` where they can be: small numbers instead of long slugs;
// - evidence is stored once in a page-wide table (`ev`) and edges list indexes into it: a file's
//   import shows up again on every board above it, and deflate's 32KB window can't see that far;
// - layout routes are right-angled (ELK), so each point after the first moves along one axis
//   only: such a route keeps one number per point, with the starting axis in the flag;
// - a node's file indexes are deltas (a leaf's files are interned together, so mostly 1s);
// - derived flow titles ("A → B", "A → B via C") are rebuilt from the flow's path.
// The viewer imports only decodeWire; esbuild drops encodeWire from the page.
import type { BoardLayout } from "../build/layout.ts";
import type { PageBoard, PageEdge, PathRef, ViewerData } from "./state.ts";
import type { FileEdge } from "../model/fgraph.ts";

type Extra = Partial<Omit<PageEdge, Fixed>>;
type Fixed = "a" | "b" | "imports" | "calls" | "uses" | "major" | "ev";
type Id = number | string;
type Ev = PageEdge["ev"][number];
/** [a[], b[], imports[], calls[], uses[], major (0|1)[], evidence indexes (deltas)[][], extra fields (0 when none)[]?] */
type EdgeColumns = [Id[], Id[], number[], number[], number[], number[], number[][], (Extra | 0)[]?];
type WireBoard = Omit<PageBoard, "edges"> & { edges: EdgeColumns };
type WireLayout = { n: [Id, number, number, number, number, 0 | 1][]; e: [Id, Id, number, ...number[]][] };
/** [path as ids, title (0: "A → B", i: "… via path[i]", or the text), captions?] */
type WireFlow = [Id[], string | number, string[]?];
/** The evidence table as columns: file (delta from the previous row), line (delta within a file), target. */
type EvTable = [number[], number[], PathRef[]];
/**
 * The file graph (`fgraph`) leans on the evidence table: each pair's evidence row joins `ev` (on
 * the big repos 90-98% of them are there already, as some board edge's evidence), and the pair
 * is stored as that row's index. Sorted by row, the indexes go up, so they travel as deltas
 * (mostly 1s). The row gives the pair's from file, line and, for an import, its to file; a pair
 * whose evidence is a call keeps its to file in `to`, in row order. Then imports and calls.
 */
type WireGraph = [rows: number[], imports: number[], calls: number[], to: number[]];
/** The Simple stop's nodes and boards travel like the page's own (its evidence joins `ev`). */
type WireSimple = { nodes: ViewerData["nodes"]; boards: Record<string, WireBoard> };
export type WireData = Omit<ViewerData, "boards" | "layout" | "flows" | "fgraph" | "simple"> & { boards: Record<string, WireBoard>; layout: Record<string, WireLayout>; flows?: Record<string, WireFlow[]>; ev: EvTable; fg?: WireGraph; simple?: WireSimple };

const FIXED: readonly string[] = ["a", "b", "imports", "calls", "uses", "major", "ev"];
const map = <T, U>(o: Record<string, T>, f: (v: T, k: string) => U): Record<string, U> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));
const idx = (nodes: string[]) => { const m = new Map(nodes.map((n, i) => [n, i])); return (id: string): Id => m.get(id) ?? id; };
const unidx = (nodes: string[]) => (x: Id) => (typeof x === "number" ? nodes[x] : x);

/** Successive differences of the numbers in a list; anything else passes through. */
function delta<T>(xs: T[], undo: boolean): T[] {
  let prev = 0;
  return xs.map((x) => {
    if (typeof x !== "number") return x;
    const out = undo ? prev + x : x - prev;
    prev = undo ? out : x;
    return out as T;
  });
}

const evKey = ([f, l, t]: Ev) => `${String(f).padStart(9, "0")}\u0000${String(l).padStart(9, "0")}\u0000${typeof t}${t}`;

/** A file pair's evidence, as a board edge would carry it. */
const pairEv = ([a, b, , , line, call]: FileEdge<number>): Ev => [a, line, call ?? b];

function evTable(d: ViewerData): { table: EvTable; at: Map<string, number> } {
  const all = new Map<string, Ev>();
  for (const b of [...Object.values(d.boards), ...Object.values(d.simple?.boards ?? {})]) for (const e of b.edges) for (const v of e.ev) all.set(evKey(v), v);
  for (const e of d.fgraph ?? []) all.set(evKey(pairEv(e)), pairEv(e));
  const keys = [...all.keys()].sort();
  const table: EvTable = [[], [], []];
  let pf = 0, pl = 0;
  keys.forEach((k) => {
    const [f, l, t] = all.get(k)!;
    const fn = f as number;
    table[0].push(fn - pf); table[1].push(fn === pf ? l - pl : l); table[2].push(t);
    pf = fn; pl = l;
  });
  return { table, at: new Map(keys.map((k, i) => [k, i])) };
}

function evRows([df, dl, t]: EvTable): Ev[] {
  let f = 0, l = 0;
  return df.map((x, i) => { l = x === 0 && i > 0 ? l + dl[i] : dl[i]; f += x; return [f, l, t[i]]; });
}

function edgeColumns(edges: PageEdge[], id: (x: string) => Id, at: Map<string, number>): EdgeColumns {
  const extra = edges.map((e) => {
    const rest = Object.entries(e).filter(([k]) => !FIXED.includes(k));
    return rest.length ? (Object.fromEntries(rest) as Extra) : 0;
  });
  const cols: EdgeColumns = [
    edges.map((e) => id(e.a)), edges.map((e) => id(e.b)), edges.map((e) => e.imports), edges.map((e) => e.calls),
    edges.map((e) => e.uses), edges.map((e) => (e.major ? 1 : 0)), edges.map((e) => delta(e.ev.map((v) => at.get(evKey(v))!), false)),
  ];
  if (extra.some((x) => x)) cols.push(extra);
  return cols;
}

function edgeRows([a, b, imports, calls, uses, major, ev, extra]: EdgeColumns, id: (x: Id) => string, evs: Ev[]): PageEdge[] {
  return a.map((_, i) => ({
    a: id(a[i]), b: id(b[i]), imports: imports[i], calls: calls[i], uses: uses[i], major: major[i] === 1,
    ev: delta(ev[i], true).map((j) => [...evs[j]] as Ev), ...(extra?.[i] || {}),
  }));
}

/** A route [x0, y0, x1, y1, …] as [x0, y0, step, step, …] when every step moves along one axis, alternating. */
function squash(pts: number[]): { axis: 0 | 1; out: number[] } | null {
  if (pts.length < 4 || pts.length % 2) return null;
  const axis = pts[2] !== pts[0] ? 0 : 1;
  const out = [pts[0], pts[1]];
  for (let i = 2, ax = axis; i < pts.length; i += 2, ax = (1 - ax) as 0 | 1) {
    const moved = pts[i + ax] - pts[i - 2 + ax], still = pts[i + 1 - ax] - pts[i - 1 - ax];
    if (!moved || still) return null;
    out.push(moved);
  }
  return { axis, out };
}

function unsquash(axis: number, s: number[]): number[] {
  const pts = [s[0], s[1]];
  for (let i = 2, ax = axis; i < s.length; i++, ax = 1 - ax) {
    const x = pts[pts.length - 2], y = pts[pts.length - 1];
    pts.push(ax ? x : x + s[i], ax ? y + s[i] : y);
  }
  return pts;
}

/** Plain routes keep their flag (0|1) and deltas from the previous point; squashed ones add 2 (x first) or 4 (y first). */
function route([a, b, f, ...pts]: BoardLayout["e"][number], id: (x: string) => Id): WireLayout["e"][number] {
  const sq = squash(pts);
  if (sq) return [id(a), id(b), f + 2 + 2 * sq.axis, ...sq.out];
  return [id(a), id(b), f, ...pts.map((p, i) => p - (i < 2 ? 0 : pts[i - 2]))];
}

function unroute([a, b, f, ...pts]: WireLayout["e"][number], id: (x: Id) => string): BoardLayout["e"][number] {
  if (f >= 2) return [id(a), id(b), (f % 2) as 0 | 1, ...unsquash(f >= 4 ? 1 : 0, pts)];
  const out: number[] = [];
  pts.forEach((p, i) => out.push((i < 2 ? 0 : out[i - 2]) + p));
  return [id(a), id(b), f as 0 | 1, ...out];
}

/** What model/flows.ts calls a box in a derived flow's title. */
function namer(d: Pick<ViewerData, "paths" | "services" | "nodes" | "names">) {
  return (id: string) => (id[0] === "@" ? (d.names?.[id] ?? d.paths[+id.slice(1)].replace(/^.*\//, "")).replace(/\.[^./]+$/, "") : d.services[id] ?? d.nodes[id]?.name ?? id);
}
const autoTitle = (path: string[], name: (id: string) => string, via: number) =>
  `${name(path[0])} → ${name(path[path.length - 1])}${via ? ` via ${name(path[via])}` : ""}`;

function flowWire({ title, path, captions }: NonNullable<ViewerData["flows"]>[string][number], id: (x: string) => Id, name: (id: string) => string): WireFlow {
  let t: string | number = title;
  for (let v = 0; v < path.length - 1 && t === title; v++) if (autoTitle(path, name, v) === title) t = v;
  return captions ? [path.map(id), t, captions] : [path.map(id), t];
}

function graphWire(g: FileEdge<number>[], at: Map<string, number>): WireGraph {
  const rows = g.map((e) => [at.get(evKey(pairEv(e)))!, e] as const).sort((x, y) => x[0] - y[0]);
  return [delta(rows.map(([i]) => i), false), rows.map(([, e]) => e[2]), rows.map(([, e]) => e[3]), rows.flatMap(([, e]) => (e[5] === undefined ? [] : [e[1]]))];
}

/** Back in the page's order: by from path, then to path (model/fgraph.ts). */
function graphRows([rows, imports, calls, to]: WireGraph, evs: Ev[], paths: string[]): FileEdge<number>[] {
  let k = 0;
  const out = delta(rows, true).map((r, i): FileEdge<number> => {
    const [a, line, t] = evs[r];
    return typeof t === "number" ? [a as number, t, imports[i], calls[i], line] : [a as number, to[k++], imports[i], calls[i], line, t];
  });
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((x, y) => cmp(paths[x[0]], paths[y[0]]) || cmp(paths[x[1]], paths[y[1]]));
}

export function encodeWire(d: ViewerData): WireData {
  const { table, at } = evTable(d);
  const ids = (k: string) => idx(d.boards[k]?.nodes ?? []);
  const name = namer(d);
  const { fgraph, simple: _s, ...plain } = d;
  const { flows } = d;
  return {
    ...(plain as Omit<ViewerData, "flows" | "fgraph" | "simple">),
    nodes: map(d.nodes, (n) => ({ ...n, files: delta(n.files, false) })),
    boards: map(d.boards, (b, k) => ({ ...b, edges: edgeColumns(b.edges, ids(k), at) })),
    layout: map(d.layout, (l, k) => ({ ...l, n: l.n.map(([n, ...r]) => [ids(k)(n), ...r]), e: l.e.map((e) => route(e, ids(k))) })),
    ...(flows ? { flows: map(flows, (fs, k) => fs.map((f) => flowWire(f, ids(k), name))) } : {}),
    ...(d.simple ? { simple: { nodes: map(d.simple.nodes, (n) => ({ ...n, files: delta(n.files, false) })), boards: map(d.simple.boards, (b) => ({ ...b, edges: edgeColumns(b.edges, idx(b.nodes), at) })) } } : {}),
    ev: table,
    ...(fgraph ? { fg: graphWire(fgraph, at) } : {}),
  };
}

export function decodeWire(w: WireData): ViewerData {
  const { ev, flows, ...rest } = w;
  const evs = evRows(ev);
  // flows go back where they were, so the result matches the input key for key
  const keep = flows ? (w as Omit<WireData, "ev">) : rest;
  const ids = (k: string) => unidx(w.boards[k]?.nodes ?? []);
  const nodes = map(w.nodes, (n) => ({ ...n, files: delta(n.files, true) }));
  const name = namer({ ...w, nodes });
  const out = {
    ...keep,
    nodes,
    boards: map(w.boards, (b, k) => ({ ...b, edges: edgeRows(b.edges, ids(k), evs) })),
    layout: map(w.layout, (l, k) => ({ ...l, n: l.n.map(([n, ...r]) => [ids(k)(n), ...r]), e: l.e.map((e) => unroute(e, ids(k))) })),
    ...(flows ? { flows: map(flows, (fs, k) => fs.map(([p, t, captions]) => {
      const path = p.map(ids(k));
      return { title: typeof t === "number" ? autoTitle(path, name, t) : t, path, ...(captions ? { captions } : {}) };
    })) } : {}),
    ...(w.simple ? { simple: { nodes: map(w.simple.nodes, (n) => ({ ...n, files: delta(n.files, true) })), boards: map(w.simple.boards, (b) => ({ ...b, edges: edgeRows(b.edges, unidx(b.nodes), evs) })) } } : {}),
  } as ViewerData & { ev?: unknown; fg?: unknown };
  delete out.ev;
  delete out.fg;
  // last, where build/html.ts puts it
  if (w.fg) out.fgraph = graphRows(w.fg, evs, w.paths);
  if (out.simple) { const s = out.simple; delete out.simple; out.simple = s; }
  return out;
}
