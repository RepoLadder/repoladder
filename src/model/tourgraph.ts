// What composeTour and findChains read from the page data (docs/tours-data.md), indexed once per
// graph. Pure and free of Node code, so the viewer can run it on its own page data.
import type { FileEdge } from "./fgraph.ts";
import type { PageBoard, PageNode, PathRef } from "../viewer/state.ts";

/**
 * The minimal page data a tour is built from. `ViewerData` (the page's own data) is one: pass it
 * as is. Files are path indexes or paths; file boxes on boards are "@<path index>".
 */
export interface TourGraph {
  paths: string[];
  /** The Default group tree: parent, children, a leaf's files, name and summary. */
  nodes: Record<string, PageNode>;
  /** The tree with Simple's split parts as `fine` nodes (set by the viewer's unpack); cuts read it when present. */
  tree?: Record<string, PageNode>;
  /** The Default boards: what each draws, and every rolled-up edge with its evidence. */
  boards: Record<string, Pick<PageBoard, "nodes" | "edges" | "context">>;
  /** Every file-to-file connection once (model/fgraph.ts). */
  fgraph?: FileEdge<PathRef>[];
  /** Service and store ids -> names. */
  services?: Record<string, string>;
}

/** A chain the graph can't show: names the hop, and whether the edge exists the other way. */
export class ChainError extends Error {
  hop?: [string, string];
  reversed: boolean;
  constructor(message: string, hop?: [string, string], reversed = false) {
    super(message);
    this.name = "ChainError";
    this.hop = hop;
    this.reversed = reversed;
  }
}

/** A sink: a service ("svc-…") or a store ("store-…") id. */
export const isSink = (id: string) => id.startsWith("svc-") || id.startsWith("store-");

export interface Index {
  g: TourGraph;
  /** path -> path index */
  at: Map<string, number>;
  /** file -> its groups from the root's child down to its leaf */
  chain: Map<number, string[]>;
  /** "a>b" (path indexes) -> the fgraph row */
  edge: Map<string, FileEdge<PathRef>>;
  /** file -> files it imports or calls, and the reverse */
  out: Map<number, number[]>;
  into: Map<number, number[]>;
  /** sink -> file -> its first evidence [line, target] */
  sinks: Map<string, Map<number, [number, string]>>;
  /** node id -> level (root 0) */
  level: (id: string) => number;
}

const cache = new WeakMap<TourGraph, Index>();

export function indexOf(g: TourGraph): Index {
  let ix = cache.get(g);
  if (ix) return ix;
  const at = new Map(g.paths.map((p, i) => [p, i]));
  const ref = (f: PathRef) => (typeof f === "number" ? f : at.get(f) ?? -1);
  const chain = new Map<number, string[]>();
  const down = (id: string, ch: string[]) => {
    const n = g.nodes[id];
    if (id !== "root" && !n.children.length) for (const f of n.files) chain.set(ref(f), ch);
    for (const k of n.children) down(k, [...ch, k]);
  };
  if (g.nodes.root) down("root", []);
  const edge = new Map<string, FileEdge<PathRef>>(), out = new Map<number, number[]>(), into = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, k: number, v: number) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const e of g.fgraph ?? []) {
    const a = ref(e[0]), b = ref(e[1]);
    edge.set(`${a}>${b}`, e);
    push(out, a, b);
    push(into, b, a);
  }
  // per-file service and store uses aren't in fgraph: every board edge into a sink cites its files
  const sinks = new Map<string, Map<number, [number, string]>>();
  for (const id of Object.keys(g.boards).sort()) {
    for (const e of g.boards[id].edges) {
      if (!isSink(e.b)) continue;
      let m = sinks.get(e.b);
      if (!m) sinks.set(e.b, (m = new Map()));
      for (const [f, line, t] of e.ev) {
        const i = ref(f), old = m.get(i);
        const target = typeof t === "number" ? g.paths[t] : t;
        // a store's read or write says more than the SDK import that precedes it
        const rank = (t: string) => (/\((read|write)\)$/.test(t) ? 0 : 1);
        if (i >= 0 && (!old || (rank(target) - rank(old[1]) || line - old[0]) < 0)) m.set(i, [line, target]);
      }
    }
  }
  const level = (id: string) => { let d = 0; for (let p = g.nodes[id]?.parent; p; p = g.nodes[p]?.parent) d++; return d; };
  ix = { g, at, chain, edge, out, into, sinks, level };
  cache.set(g, ix);
  return ix;
}

/** A file named by path, path index or "@<index>" -> its path index; undefined if it isn't on any board. */
export function fileRef(ix: Index, f: string | number): number | undefined {
  const i = typeof f === "number" ? f : f[0] === "@" ? Number(f.slice(1)) : ix.at.get(f);
  return i !== undefined && ix.chain.has(i) ? i : undefined;
}

/** Every file under a group (or the one file named), as path indexes. */
export function filesUnder(ix: Index, id: string | number): number[] {
  const f = fileRef(ix, id);
  if (f !== undefined) return [f];
  if (typeof id !== "string" || !ix.g.nodes[id]) return [];
  return [...ix.chain].filter(([, ch]) => id === "root" || ch.includes(id)).map(([i]) => i).sort((a, b) => a - b);
}
