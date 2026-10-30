// composeTour (docs/tours-v2.md): a chain of files, each consecutive pair a real fgraph edge,
// becomes a multi-depth tour. Each hop is drawn on the deepest board that holds both its files
// (their lowest common ancestor), as the arrow between the two boxes there that hold each end,
// so a tour drops into a part where the detail is and climbs back out as the chain does. Nothing
// is invented: every lit box and arrow is one the board draws at the step's stop. Pure: the build
// and the viewer share it. The page data it reads is documented in docs/tours-data.md.
import { cut, extraBoxes, stopsFor, type StopDef } from "../viewer/budget.ts";
import { drawsEdge } from "./draws.ts";
import { ChainError, fileRef, indexOf, isSink, type Index, type TourGraph } from "./tourgraph.ts";

export { ChainError, type TourGraph } from "./tourgraph.ts";
export { findChains } from "./chains.ts";

/** One step: a board at a dial stop, what it lights there, and its caption. */
export interface TourStep {
  /** A group id, or "_story". */
  board: string;
  /** The dial stop, relative as the dial stores it: "default" | "+1" | … | "everything". */
  stop: string;
  /** Drawn ids at that stop: group ids, "svc-*", "store-*", "@<path index>". */
  lit: { boxes: string[]; edges: [string, string][] };
  caption: string;
  /** The hop this step shows, when it came from a chain: [from path, to path or sink id]. */
  via?: [string, string];
}
export interface Tour { id: string; title: string; steps: TourStep[]; source: "claude" | "derived" | "flow" }

export interface ComposeOptions {
  /**
   * How many levels below the chain's top board (the deepest group holding every file of it) a
   * step may go. A hop whose own board is deeper is shown on its ancestor at that level, opened
   * to the first dial stop that draws its two ends apart. Omitted: no limit.
   */
  depth?: number;
  /** One per hop (chain.length - 1); a missing one gets a caption from the evidence. */
  captions?: (string | undefined)[];
  /** Called for a hop no board draws as an arrow, placed where the connection is only listed (tours then warn). */
  onFallback?: (info: { hop: [string, string]; board: string }) => void;
}

interface Placed { board: string; stop: string; a: string; b: string }

/** The dial's stops from Default up (Simple left out: tours run on the Default tree). */
const upward = new WeakMap<TourGraph, StopDef[]>();
function stopsUp(g: TourGraph): StopDef[] {
  let s = upward.get(g);
  if (!s) upward.set(g, (s = stopsFor(g.tree ?? g.nodes, g.paths).filter((d) => d.key !== "simple").reverse()));
  return s;
}

/**
 * Where hop a -> b is drawn on `board` at `stop`: the two boxes the arrow joins, or null. On
 * Default that is a major arrow (drawsEdge); `listed` also accepts a minor one, the warned fallback.
 */
function drawnOn(ix: Index, board: string, stop: StopDef, a: number, b: number, listed: boolean): [string, string] | null {
  const g = ix.g, def = g.boards[board], node = g.nodes[board];
  if (!def || !node) return null;
  const at = ix.level(board), ca = ix.chain.get(a)!, cb = ix.chain.get(b)!;
  if (board !== "root" && (ca[at - 1] !== board || cb[at - 1] !== board)) return null;
  if (stop.key === "default") {
    // a leaf's file board, or a group board's child boxes; the edge must be one the board has
    const x = node.children.length ? ca[at] : `@${a}`, y = node.children.length ? cb[at] : `@${b}`;
    if (!x || !y || x === y || !def.nodes.includes(x) || !def.nodes.includes(y)) return null;
    return (listed ? def.edges.some((e) => e.a === x && e.b === y) : drawsEdge(def, x, y)) ? [x, y] : null;
  }
  // every rolled-up arrow of a cut is drawn (cutboard.ts marks them all major), so no major test here
  const c = cut(g.tree ?? g.nodes, g.paths, board, stop.budget, { extra: extraBoxes(g.nodes, def as never, board) });
  // a cut that opens nothing is the Default board (stoplayout.ts cutLayout)
  if (Object.keys(c.open).length === 1) return null;
  // as cutBoard draws a file: the containers it sits in, then its closed box (or its own box)
  const drawn = (f: number, ch: string[]) => {
    const out: string[] = [];
    for (let i = at; i < ch.length; i++) { out.push(ch[i]); if (!c.open[ch[i]]) return out; }
    return [...out, `@${f}`];
  };
  const da = drawn(a, ca), db = drawn(b, cb);
  let i = 0;
  while (i < da.length && i < db.length && da[i] === db[i]) i++;
  return da[i] && db[i] ? [da[i], db[i]] : null;
}

/** The deepest group holding every file: the longest common prefix of their chains. */
function lca(ix: Index, files: number[]): string {
  const chains = files.map((f) => ix.chain.get(f)!);
  let i = 0;
  while (chains.every((c) => i < c.length && c[i] === chains[0][i])) i++;
  return i ? chains[0][i - 1] : "root";
}

const clamp = (ix: Index, id: string, cap: number) => { while (ix.level(id) > cap) id = ix.g.nodes[id].parent!; return id; };

function placeFiles(ix: Index, a: number, b: number, cap: number, listed: boolean): Placed | null {
  for (let board: string | null = clamp(ix, lca(ix, [a, b]), cap); board; board = ix.g.nodes[board].parent) {
    for (const stop of stopsUp(ix.g)) {
      const got = drawnOn(ix, board, stop, a, b, listed);
      if (got) return { board, stop: stop.key, a: got[0], b: got[1] };
    }
  }
  return null;
}

/** A file -> service or store hop: on Default, from the box that holds the file, as low as it is drawn. */
function placeSink(ix: Index, a: number, sink: string, cap: number, listed: boolean): Placed | null {
  const ch = ix.chain.get(a)!;
  for (let board: string | null = clamp(ix, ch[ch.length - 1], cap); board; board = ix.g.nodes[board].parent) {
    const def = ix.g.boards[board], n = ix.g.nodes[board];
    if (!def || !def.nodes.includes(sink)) continue;
    const x = n.children.length ? ch[ix.level(board)] : `@${a}`;
    if (x && (listed ? def.edges.some((e) => e.a === x && e.b === sink) : drawsEdge(def, x, sink))) return { board, stop: "default", a: x, b: sink };
  }
  return null;
}

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

function nameOf(g: TourGraph, id: string): string {
  return id[0] === "@" ? base(g.paths[Number(id.slice(1))]) : g.nodes[id]?.name ?? g.services?.[id] ?? id;
}

/** What the evidence says the hop is: "KioskPage.tsx imports kioskHttp.ts (web/src/pages/KioskPage.tsx:3)". */
function evidenceCaption(ix: Index, p: Placed, a: number, b: number | string): string {
  const g = ix.g, from = g.paths[a];
  let says: string;
  if (typeof b === "string") {
    const [line, target] = ix.sinks.get(b)!.get(a)!;
    says = `${base(from)} uses ${nameOf(g, b)}: ${target} (${from}:${line})`;
  } else {
    const e = ix.edge.get(`${a}>${b}`)!, to = g.paths[b];
    says = e[5] !== undefined
      ? `${base(from)} calls ${e[5].replace(` (${to})`, "")} in ${base(to)} (${from}:${e[4]})`
      : `${base(from)} imports ${base(to)} (${from}:${e[4]})`;
  }
  const ends = [p.a, p.b].filter((x) => x[0] !== "@" && !isSink(x));
  return ends.length ? `${nameOf(g, p.a)} → ${nameOf(g, p.b)}: ${says}` : says;
}

/**
 * The steps for a file chain: repo paths (or path indexes, or "@<index>"), each consecutive pair
 * an fgraph edge, optionally ending with a service or store id that the last file uses. Throws a
 * ChainError naming the first hop that isn't in the graph, and whether it exists reversed.
 */
export function composeTour(g: TourGraph, chain: (string | number)[], opts: ComposeOptions = {}): TourStep[] {
  const ix = indexOf(g);
  if (!g.fgraph) throw new ChainError("the page data has no file graph (fgraph)");
  if (chain.length < 2) throw new ChainError(`a chain needs at least two files (got ${chain.length})`);
  const last = chain[chain.length - 1];
  const sink = typeof last === "string" && isSink(last) ? last : undefined;
  const files = (sink ? chain.slice(0, -1) : chain).map((f) => {
    const i = fileRef(ix, f);
    if (i === undefined) throw new ChainError(`"${f}" is not a file on any board${typeof f === "string" && isSink(f) ? " (a service or store may only end a chain)" : ""}`);
    return i;
  });
  const top = ix.level(lca(ix, files));
  const cap = opts.depth === undefined ? Infinity : top + Math.max(0, opts.depth);
  const steps: TourStep[] = [];
  const hops: [number, number | string][] = files.slice(1).map((b, i) => [files[i], b]);
  if (sink) hops.push([files[files.length - 1], sink]);
  hops.forEach(([a, b], i) => {
    const pa = g.paths[a], pb = typeof b === "string" ? b : g.paths[b];
    if (typeof b === "string") {
      if (!ix.sinks.get(b)?.has(a)) throw new ChainError(`hop ${i + 1}: ${pa} does not use ${b}`, [pa, pb]);
    } else if (!ix.edge.has(`${a}>${b}`)) {
      const rev = ix.edge.has(`${b}>${a}`);
      throw new ChainError(`hop ${i + 1}: there is no edge ${pa} -> ${pb}${rev ? ` (there is one ${pb} -> ${pa}; edges point from the file that imports or calls)` : ""}`, [pa, pb], rev);
    }
    const put = (c: number, listed: boolean) => (typeof b === "string" ? placeSink(ix, a, b, c, listed) : placeFiles(ix, a, b, c, listed));
    // a board that draws the hop wins, over the author's depth cap too; else the old listed-only placement
    let p = put(cap, false) ?? (cap === Infinity ? null : put(Infinity, false));
    if (!p && (p = put(cap, true))) opts.onFallback?.({ hop: [pa, pb], board: p.board });
    if (!p) throw new ChainError(`hop ${i + 1}: ${pa} -> ${pb} is not drawn on any board`, [pa, pb]);
    steps.push({ board: p.board, stop: p.stop, lit: { boxes: [p.a, p.b], edges: [[p.a, p.b]] }, caption: opts.captions?.[i] ?? evidenceCaption(ix, p, a, b), via: [pa, pb] });
  });
  return steps;
}
