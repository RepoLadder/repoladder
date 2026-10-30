// The roll-up rules every board shares, pure and free of facts, so the build (rollup.ts,
// fileboards.ts) and the page (viewer/stops.ts, the detail dial's merged stops) draw the same
// arrows from the same counts. The edge type is generic: the build's evidence is paths, the page's
// is path indexes, and no rule reads evidence.
import type { Board, ModelEdge } from "./rollup.ts";
import { connectOrphans } from "./orphans.ts";
import { roomForStores } from "./storeroom.ts";

export type RollEdge = Omit<ModelEdge, "ev">;

/** Evidence rows noted per group-board edge, one per from-file. */
export const EVIDENCE_PER_EDGE = 6;
/** On a file board: evidence rows per edge. */
export const FILE_EVIDENCE = 3;

const weight = (e: RollEdge) => e.imports + e.calls * 3;
const heaviest = (x: RollEdge, y: RollEdge) => weight(y) - weight(x) || x.a.localeCompare(y.a) || x.b.localeCompare(y.b);
export const byEnds = (x: RollEdge, y: RollEdge) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b);

/**
 * Where a connection between two files lands on the board of the group at the end of `own` (its
 * ids from the root's child down; [] for the root): between two of its children, or between a
 * child and the part elsewhere that the other file belongs to, at the level where its path splits
 * from ours (inside "Web app", backend files show up as "Cloud backend"). `chainOf` gives a
 * file's group ids from the root's child down to its leaf. `childOf` gives a file's box on the board:
 * by default the child its chain runs through (a leaf's file board passes its own, viewer/stops.ts).
 */
export function boardEnds<F>(own: readonly string[], chainOf: (file: F) => readonly string[] | undefined, childOf = (file: F): string | null => {
  const c = chainOf(file);
  if (!c || (own.length > 0 && c[own.length - 1] !== own[own.length - 1])) return null;
  return c[own.length] ?? null;
}) {
  const depth = own.length;
  const contextOf = (file: F): string | null => {
    const c = chainOf(file);
    if (!c || depth === 0) return null;
    for (let i = 0; i < depth; i++) if (c[i] !== own[i]) return c[i] ?? null;
    return null;
  };
  /** [a, b, isContext], or null when the connection isn't on this board. */
  const ends = (from: F, to: F): [string, string, boolean] | null => {
    const a = childOf(from), b = childOf(to);
    if (a && b) return a === b ? null : [a, b, false];
    if (a && !b) { const x = contextOf(to); return x ? [a, x, true] : null; }
    if (!a && b) { const x = contextOf(from); return x ? [x, b, true] : null; }
    return null;
  };
  return { childOf, contextOf, ends };
}

/**
 * A group board from its rolled-up edges: which arrows are drawn, which hubs and services are only
 * listed, and the "elsewhere" boxes. `used` holds the services and stores its children touch;
 * `may` says whether an id may join the board as an elsewhere box.
 */
export function finishGroupBoard<E extends RollEdge>(id: string, children: string[], all: Iterable<E>, ctxEdges: Set<E>, used: Set<string>, may: (id: string) => boolean): Omit<Board, "edges" | "collections"> & { edges: E[] } {
  const list = [...all].sort(byEnds);
  const hubs = markMajor(list.filter((e) => !ctxEdges.has(e)), children);
  markContext([...ctxEdges], list.filter((e) => !ctxEdges.has(e) && !e.uses), children.length);
  // Inside a part, a service used by most of its groups (Firebase everywhere) is infrastructure:
  // listed, not drawn, so it doesn't pull wires across the whole board.
  const drawn = [...used].sort().filter((svc) => id === "root" || list.filter((e) => e.b === svc).length <= 3);
  const majorCtx = () => [...ctxEdges].filter((e) => e.major).flatMap((e) => [e.a, e.b]).filter((x) => !children.includes(x));
  // a store is drawn anyway when the board has room (storeroom.ts)
  if (id !== "root") {
    const arrows = list.filter((e) => e.major && (!e.uses || drawn.includes(e.b))).length;
    drawn.push(...roomForStores(list, used, drawn, children.length + new Set(majorCtx()).size + drawn.length, arrows));
    drawn.sort();
  }
  for (const e of list) if (e.uses && !drawn.includes(e.b)) e.major = false;
  // every box with a connection keeps at least one drawn arrow, ideally to a box already shown
  connectOrphans(list.filter((e) => !e.uses || drawn.includes(e.b)), children, [...children, ...drawn, ...majorCtx()], may);
  const context = [...new Set(majorCtx())].sort();
  return { nodes: [...children, ...context, ...drawn], context, hubs, edges: list, throughout: [...used].sort().filter((svc) => !drawn.includes(svc)) };
}

/**
 * The same for a leaf's file board: `boxes` are its file boxes (and `more`, the "+N more" box, when it
 * has one). The file rung is where every connection is guaranteed an arrow (#449): each edge between
 * files, to an "elsewhere" box, and to a service or store is drawn, with no budget and no hub or
 * "used throughout" listing. Too dense a board is split into more rungs, never thinned.
 */
export function finishFileBoard<E extends RollEdge>(boxes: string[], more: string, isFile: (id: string) => boolean, all: Iterable<E>, ctxEdges: Set<E>, used: Set<string>, may: (id: string) => boolean): Omit<Board, "edges" | "collections"> & { edges: E[] } {
  const list = [...all].sort(byEnds);
  for (const e of list) e.major = true;
  // safety net only: every edge is already drawn, so this promotes nothing
  const drawn = [...used].sort();
  connectOrphans(list, boxes, [...boxes, ...drawn], may);
  const context = [...new Set([...ctxEdges].flatMap((e) => [e.a, e.b]).filter((x) => !isFile(x)))].sort();
  return { nodes: [...boxes, ...context, ...drawn], context, hubs: [], edges: list, throughout: [] };
}

/**
 * Folders inside an app usually all import each other; drawing every edge is a hairball.
 * Keep every runtime-call and service edge, each box's strongest outgoing edge, and the heaviest
 * of the rest, up to about 1.5 edges per box (1.2 on a densely meshed board).
 * Returns the hubs whose incoming edges were hidden.
 */
export function markMajor(edges: RollEdge[], children: string[]): string[] {
  const boxes = children.length;
  // A part imported by most of its siblings (shared UI, helpers) is foundation: every box would
  // point at it. Its incoming edges are listed, not drawn.
  // Hub = imported by most siblings, consumed far more than it consumes, and a big share of all imports.
  const imp = edges.filter((e) => !e.uses && e.imports > 0);
  const total = imp.reduce((n, e) => n + e.imports, 0);
  const hubs = boxes < 4 ? [] : children.filter((id) => {
    const inc = imp.filter((e) => e.b === id), out = imp.filter((e) => e.a === id);
    const win = inc.reduce((n, e) => n + e.imports, 0), wout = out.reduce((n, e) => n + e.imports, 0);
    return inc.length >= Math.ceil((boxes - 1) * 0.75) && win >= 2 * wout && win >= total * 0.25;
  });
  for (const e of imp) if (hubs.includes(e.b) && !e.calls) e.hub = true;
  if (!hubs.length) return pickMajor(edges, boxes, []);
  // Hiding a hub's arrows only pays off on a busy board. On a small one (4 boxes or fewer), or when
  // fewer than 2 code arrows would be left, "everything is built on X" is the board's story: draw it.
  const hidden = pickMajor(edges, boxes, hubs);
  const left = edges.filter((e) => e.major && !e.uses).length;
  return boxes > 4 && left >= 2 ? hidden : pickMajor(edges, boxes, []);
}

function pickMajor(edges: RollEdge[], boxes: number, hubs: string[]): string[] {
  const code = edges.filter((e) => !e.uses && !(hubs.includes(e.b) && !e.calls));
  // runtime calls and service/store edges are never hidden
  for (const e of edges) e.major = e.uses > 0 || e.calls > 0;
  // A tight mesh (UI components importing each other) gets a smaller budget, and a box whose
  // strongest edge is weak (1-2 imports) no longer gets a guaranteed arrow.
  const dense = boxes >= 5 && code.length >= boxes * (boxes - 1) * 0.3;
  const strongest = new Map<string, RollEdge>();
  for (const e of code) if (!strongest.has(e.a) || weight(e) > weight(strongest.get(e.a)!)) strongest.set(e.a, e);
  for (const e of strongest.values()) if (!dense || weight(e) >= 3) e.major = true;
  const max = Math.max(0, ...code.map(weight));
  const budget = Math.max(Math.round(boxes * (dense ? 1.2 : 1.5)), 6);
  const rest = code.filter((e) => !e.major && weight(e) >= Math.max(2, max * 0.1)).sort(heaviest);
  let drawn = code.filter((e) => e.major).length;
  for (const e of rest) { if (drawn >= budget) break; e.major = true; drawn++; }
  reduceShortcuts(code);
  return hubs;
}

/**
 * Transitive reduction, for weak shortcuts only: A->C isn't drawn when A->B->C is, and A->C is
 * import-only and at most half as heavy as either leg. The path still shows that A reaches C.
 */
export function reduceShortcuts(code: RollEdge[]): void {
  const on = new Map(code.filter((e) => e.major).map((e) => [`${e.a}>${e.b}`, e]));
  const legs = new Set<RollEdge>();
  // lightest first; a leg that carries a hidden shortcut stays drawn
  for (const e of [...on.values()].sort(heaviest).reverse()) {
    if (e.calls || legs.has(e)) continue;
    for (const ab of on.values()) {
      if (ab.a !== e.a || ab.b === e.b || !ab.major) continue;
      const bc = on.get(`${ab.b}>${e.b}`);
      if (!bc?.major || weight(e) * 2 > Math.min(weight(ab), weight(bc))) continue;
      e.major = false;
      legs.add(ab).add(bc);
      break;
    }
  }
}

/**
 * Edges to and from boxes elsewhere in the system. Runtime calls always show; imports only when
 * they're a big share of the board, and only the heaviest few: whatever the board's own arrows
 * left of its budget, and at least one per two boxes. Otherwise a part that leans on many others
 * drowns its own board in arrows going out.
 */
export function markContext(ctx: RollEdge[], inside: RollEdge[], boxes: number): void {
  const maxInside = Math.max(0, ...inside.map(weight));
  const fit = ctx.filter((e) => !e.calls && weight(e) >= Math.max(3, maxInside * 0.2)).sort(heaviest);
  const left = Math.max(Math.round(boxes * 1.5), 6) - inside.filter((e) => e.major).length;
  for (const e of ctx) e.major = e.calls > 0;
  for (const e of fit.slice(0, Math.max(left, Math.round(boxes * 0.5)))) e.major = true;
}
