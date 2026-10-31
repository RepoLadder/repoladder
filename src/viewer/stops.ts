// Boards rolled up in the browser: from a group tree, the file graph
// (`fgraph`) and the Default boards, the boards the Simple stop draws (stopsimple.ts), in the shape
// of `ViewerData.boards`; `roll` also sums a cut's arrows (cutboard.ts). Code arrows are summed
// from the file graph by the same rules the build uses (model/rollrules.ts); service and store
// arrows are copied from the Default boards, since the page carries them per box, not per file.
// Nothing is laid out here. Pure: no DOM.
import { boardEnds, EVIDENCE_PER_EDGE, FILE_EVIDENCE, finishFileBoard, finishGroupBoard } from "../model/rollrules.ts";
import type { FileEdge } from "../model/fgraph.ts";
import { STORY, type PageBoard, type PageEdge, type PageNode, type ViewerData } from "./state.ts";
import type { StopTree } from "./stoptree.ts";
import { storeCollections } from "./stopstores.ts";
import { simpleStop } from "./stopsimple.ts";
import { fileIds } from "./stopmodel.ts";

/** The stop rolled up and laid out board by board in the page; the others are cuts (budget.ts). */
export type Stop = "simple";

/**
 * A board with containers (a cut, cutboard.ts; Everything is the root's cut at Infinity) also says
 * which container each box sits in (a group id, or the board's own id), and which cut it draws.
 */
export type StopBoard = PageBoard & { inside?: Record<string, string>; cut?: { board: string; budget: number } };

export interface StopData {
  nodes: Record<string, PageNode>;
  boards: Record<string, StopBoard>;
  /** Simple only: each id that only Simple has -> the Default box that holds it. */
  toDefault?: Record<string, string>;
}

type Row = FileEdge<number>;
export type Ends = (from: number, to: number) => [string, string, boolean] | null;
const MORE = "+more";
const isFile = (id: string) => id[0] === "@" || id === MORE;

export const rollStop = (data: ViewerData, _stop: Stop): StopData => simpleStop(data);

/**
 * The boards of a stop's tree. `given` returns a board to use as it is (Simple: the boards the
 * build shipped, and the Default boards nothing changed); `reroll` says a leaf's file board must
 * be rolled again even though every box on it still exists (Simple: its "elsewhere" boxes may now
 * be a bucket).
 */
export function rollBoards(data: ViewerData, t: StopTree, given: (id: string) => StopBoard | undefined = () => undefined, reroll: (id: string) => boolean = () => false): Record<string, StopBoard> {
  const boards: Record<string, StopBoard> = {};
  if (data.boards[STORY]) boards[STORY] = data.boards[STORY];
  const may = (id: string) => !!t.nodes[id];
  for (const n of Object.values(t.nodes)) {
    const fixed = given(n.id);
    if (fixed) boards[n.id] = fixed;
    else if (n.children.length) {
      const own = chainOf(n.id, t);
      const { childOf, ends } = boardEnds(own, (f: number) => t.chain.get(f));
      const { edges, ctx } = roll(data, ends, EVIDENCE_PER_EDGE, false);
      // each box's service and store arrows are on the Default board of the group it was drawn on
      const used = new Set<string>();
      for (const x of n.children) for (const e of data.boards[data.nodes[x]?.parent ?? ""]?.edges ?? []) {
        if (e.a !== x || !e.uses) continue;
        edges.set(`${e.a}>${e.b}`, { ...e, major: false, ev: [...e.ev] });
        used.add(e.b);
      }
      const b: StopBoard = finishGroupBoard(n.id, n.children, edges.values(), ctx, used, may);
      const colls = storeCollections(data, n.children, used, childOf);
      if (colls) b.collections = colls;
      boards[n.id] = b;
    } else if (data.boards[n.id]) boards[n.id] = fileBoard(data, t, n.id, reroll(n.id));
  }
  // store boards draw readers and writers by the Default tree (model/storeboards.ts), per file uses the page lacks
  for (const id of Object.keys(data.stores ?? {})) if (data.boards[id]) boards[id] = given(id) ?? data.boards[id];
  return boards;
}

/** A group's kept ids from the root's child down to it ([] for the root). */
function chainOf(id: string, t: StopTree): string[] {
  const c: string[] = [];
  for (let x: string | null = id; x && x !== "root"; x = t.nodes[x].parent) c.unshift(x);
  return c;
}

/**
 * Sums the file graph onto a board's boxes. Evidence follows rollup.ts: rows that import first,
 * then rows that only call, each in path order, one row per from-file on a group board (one per
 * file and line on a file board), up to `max`. The graph keeps each pair's first line only, so a
 * file board can show fewer rows than the build would.
 */
export function roll(data: ViewerData, ends: Ends, max: number, perLine: boolean): { edges: Map<string, PageEdge>; ctx: Set<PageEdge> } {
  const edges = new Map<string, PageEdge>(), ctx = new Set<PageEdge>(), rows = new Map<PageEdge, Row[]>();
  for (const r of data.fgraph ?? []) {
    const x = ends(r[0], r[1]);
    if (!x) continue;
    const k = `${x[0]}>${x[1]}`;
    let e = edges.get(k);
    if (!e) { edges.set(k, (e = { a: x[0], b: x[1], imports: 0, calls: 0, uses: 0, major: false, ev: [] })); rows.set(e, []); }
    if (x[2]) ctx.add(e);
    e.imports += r[2];
    e.calls += r[3];
    rows.get(e)!.push(r);
  }
  const P = data.paths;
  const order = (x: Row, y: Row) => P[x[0]].localeCompare(P[y[0]]) || x[4] - y[4] || (x[5] ?? P[x[1]]).localeCompare(y[5] ?? P[y[1]]);
  for (const [e, rs] of rows) {
    const seen = new Set<string>();
    for (const r of [...rs.filter((r) => r[2] > 0).sort(order), ...rs.filter((r) => !r[2]).sort(order)]) {
      const key = perLine ? `${r[0]}:${r[4]}` : String(r[0]);
      if (e.ev.length >= max) break;
      if (seen.has(key)) continue;
      seen.add(key);
      e.ev.push([r[0], r[4], r[5] ?? r[1]]);
    }
  }
  return { edges, ctx };
}

/**
 * A leaf's file board. The Default one stands unless `force` (Simple: an "elsewhere" box on it may
 * now be a bucket): then its connections out are re-rolled, so they land on what the tree draws
 * there. Its file boxes and "+N more" stay as they were.
 */
function fileBoard(data: ViewerData, t: StopTree, leaf: string, force: boolean): StopBoard {
  const def = data.boards[leaf];
  if (!force) return def;
  // laid out with the build's file ids ("f:<path>", model/fileboards.ts) so ties break as they do there
  const P = data.paths, { toF, toAt } = fileIds(P);
  const isF = (id: string) => id.startsWith("f:") || id === MORE;
  const boxes = def.nodes.filter(isFile).map(toF);
  const shown = new Set(boxes);
  const own = chainOf(leaf, t);
  const boxOf = (f: number) => (t.leafOf.get(f) !== leaf ? null : shown.has(`f:${P[f]}`) ? `f:${P[f]}` : MORE);
  // a leaf's own files are its boxes; the rest are elsewhere as on any board
  const { ends } = boardEnds(own, (f: number) => t.chain.get(f), boxOf);
  const { edges, ctx } = roll(data, ends, FILE_EVIDENCE, true);
  const used = new Set<string>();
  for (const e of def.edges) if (e.uses) { edges.set(`${toF(e.a)}>${e.b}`, { ...e, a: toF(e.a), major: false, ev: [...e.ev] }); used.add(e.b); }
  const b = finishFileBoard(boxes, MORE, isF, edges.values(), ctx, used, (id) => !!t.nodes[id], data.profile);
  return { ...b, nodes: b.nodes.map(toAt), hubs: b.hubs.map(toAt), edges: b.edges.map((e) => ({ ...e, a: toAt(e.a), b: toAt(e.b) })) };
}
