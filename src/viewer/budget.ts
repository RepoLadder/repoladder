// The detail dial v2 (docs/detail-dial-v2.md): a stop is a box budget per board. A board opens its
// own parts in place, evenly a level at a time, until the next opening would go over the budget.
// Pure: no DOM, so tests run it in Node.
import type { PageBoard, PageNode, PathRef } from "./state.ts";

/** A stop of this repo's dial. stopsFor returns them top (More: everything) to bottom (Less: Simple). */
export interface StopDef {
  key: "everything" | `+${number}` | "default" | "simple";
  /** Infinity for everything, 0 for default/simple. */
  budget: number;
  /** What the dial calls it (#265): "More" | "Default" | "Less"; the stops between are unnamed (""). */
  label: string;
}

/** What board `board` draws at `budget`. Ids: group ids, and "@<path index>" for files. */
export interface Cut {
  board: string;
  budget: number;
  /** Every opened group (the board itself included) -> what it holds, in tree order. */
  open: Record<string, string[]>;
  /** The closed boxes drawn (leaves of `open`). */
  boxes: string[];
}

/** Default's own cap: the middle stops are round(D × STEP^k). */
export const D = 12;
export const STEP = 2.5;

/** Simple's split parts (plan step 5) are nodes marked `fine`; every stop but Simple skips them. */
type Node = PageNode & { fine?: boolean };
const isFine = (nodes: Record<string, PageNode>, id: string) => !!(nodes[id] as Node | undefined)?.fine;
export const idx = (f: PathRef, paths: string[]) => (typeof f === "number" ? f : paths.indexOf(f));
const fileId = (f: PathRef, paths: string[]) => `@${idx(f, paths)}`;

export interface CutOptions {
  /**
   * Boxes the board draws besides its parts: its "elsewhere" lane and its services, which count
   * toward the budget as they do on Default (see extraBoxes). Default 0.
   */
  extra?: number;
  /** Show `fine` nodes (the Simple stop). Default false: a fine node is replaced by what it holds. */
  fine?: boolean;
  /**
   * What an opened part (a container) counts toward the budget, besides its contents. Default 0;
   * the plan's fallback if boards come out too busy is ½.
   */
  containers?: number;
}

/** What a group draws when opened: its children (fine ones spliced out unless shown), or a leaf's files. */
function contents(nodes: Record<string, PageNode>, paths: string[], id: string, fine: boolean): string[] {
  const kids = (n: string): string[] => nodes[n].children.flatMap((c) => (!fine && isFine(nodes, c) && nodes[c].children.length ? kids(c) : !fine && isFine(nodes, c) ? [] : [c]));
  const k = kids(id);
  if (k.length) return k;
  return filesOf(nodes, id, fine).map((f) => fileId(f, paths));
}

/** A leaf's files; with fine nodes hidden, a split leaf's files are its fine parts' files. */
function filesOf(nodes: Record<string, PageNode>, id: string, fine: boolean): PathRef[] {
  const n = nodes[id];
  if (n.files.length || fine) return n.files;
  return n.children.filter((c) => isFine(nodes, c)).flatMap((c) => filesOf(nodes, c, fine));
}

const isGroup = (id: string) => id[0] !== "@";

/** Boxes on a Default board besides the board's own parts: its elsewhere lane and services. */
export function extraBoxes(nodes: Record<string, PageNode>, board: PageBoard | undefined, id: string): number {
  if (!board || !nodes[id]) return 0;
  const own = new Set(nodes[id].children);
  return board.nodes.filter((b) => !own.has(b) && b[0] !== "@").length;
}

export function cut(nodes: Record<string, PageNode>, paths: string[], board: string, budget: number, opts: CutOptions = {}): Cut {
  const fine = !!opts.fine, extra = opts.extra ?? 0, w = opts.containers ?? 0;
  const open: Record<string, string[]> = {};
  const memo = new Map<string, string[]>();
  const inside = (id: string) => {
    let c = memo.get(id);
    if (!c) memo.set(id, (c = contents(nodes, paths, id, fine)));
    return c;
  };
  open[board] = inside(board);
  let frontier = [...open[board]];
  // the board itself is the canvas, not a container
  const count = () => frontier.length + extra + w * (Object.keys(open).length - 1);
  const openable = () => frontier.filter((id) => isGroup(id) && inside(id).length > 0);
  const openOne = (id: string) => {
    open[id] = inside(id);
    frontier = frontier.flatMap((b) => (b === id ? open[id] : [b]));
  };
  for (;;) {
    const can = openable();
    if (!can.length) break;
    // evenly: every openable box one level deeper, if it all fits
    const all = count() - can.length + can.reduce((s, id) => s + inside(id).length + w, 0);
    if (all <= budget) {
      for (const id of can) open[id] = inside(id);
      const opened = new Set(can);
      frontier = frontier.flatMap((b) => (opened.has(b) ? open[b] : [b]));
      continue;
    }
    // otherwise the biggest first, each while it still fits; then stop
    const size = (id: string) => nodes[id].count || inside(id).length;
    for (const id of [...can].sort((a, b) => size(b) - size(a) || inside(b).length - inside(a).length)) {
      if (count() - 1 + inside(id).length + w <= budget) openOne(id);
    }
    break;
  }
  return { board, budget, open, boxes: frontier };
}

/** File (path index) -> the node that lists it (fine nodes included), per nodes object. */
const fileHome = new WeakMap<Record<string, PageNode>, Map<number, string>>();
function homeOf(nodes: Record<string, PageNode>, paths: string[], i: number): string | undefined {
  let m = fileHome.get(nodes);
  if (!m) {
    fileHome.set(nodes, (m = new Map()));
    for (const n of Object.values(nodes)) {
      if (n.children.length && !n.files.length) continue;
      // the deepest lister wins (a split leaf may list its files and its fine parts too)
      for (const f of n.files) { const k = idx(f, paths); if (!m.has(k) || isFine(nodes, n.id)) m.set(k, n.id); }
    }
  }
  return m.get(i);
}

/** The drawn box or container that holds `id` on this cut (itself, or its nearest drawn ancestor); null if not on the board. */
export function drawnHolder(c: Cut, nodes: Record<string, PageNode>, paths: string[], id: string): string | null {
  const drawn = (x: string) => x in c.open || c.boxes.includes(x);
  if (drawn(id)) return id;
  let at: string | null | undefined = id[0] === "@" ? homeOf(nodes, paths, Number(id.slice(1))) : nodes[id] ? id : undefined;
  while (at) {
    if (drawn(at)) return at;
    at = nodes[at]?.parent;
  }
  return null;
}

/**
 * #327: the group boards that exist at `budget`, the dial's layers. Each top board in `tops`
 * ([group cut as the top, its extra]) always exists. Any other group's board exists only where a
 * board that exists draws the group as a closed box; opened in place as a container it has none.
 * Budget 0 (Default) gives every group, Infinity only the tops.
 */
export function layersAt(nodes: Record<string, PageNode>, paths: string[], budget: number,
  tops: [board: string, extra: number][], extraOf: (id: string) => number): Set<string> {
  const out = new Set<string>(tops.map((t) => t[0])), todo = [...tops];
  for (let t = todo.shift(); t; t = todo.shift()) {
    for (const id of cut(nodes, paths, t[0], budget, { extra: t[1] }).boxes) {
      if (out.has(id) || !nodes[id] || !contents(nodes, paths, id, false).length) continue;
      out.add(id);
      todo.push([id, extraOf(id)]);
    }
  }
  return out;
}

/** The boards whose cuts decide whether a stop changes anything: every group that opens to something. */
const boardsOf = (nodes: Record<string, PageNode>, paths: string[]) =>
  Object.keys(nodes).filter((id) => !isFine(nodes, id) && contents(nodes, paths, id, false).length > 0);

const same = (a: Cut, b: Cut) => a.boxes.length === b.boxes.length && a.boxes.every((x, i) => x === b.boxes[i]) && Object.keys(a.open).length === Object.keys(b.open).length;

/**
 * This repo's stops, top to bottom: Everything, the middle budgets round(12 × 2.5^k) up to the
 * first one at which the root opens all the way to files (that one is Everything), Default, and
 * Simple when the page has fine nodes. A middle stop where no board differs from the stop below
 * it is dropped. Budgets count parts only (no elsewhere/service boxes): the stops don't depend on them.
 */
export function stopsFor(nodes: Record<string, PageNode>, paths: string[], root = "root"): StopDef[] {
  const boards = boardsOf(nodes, paths);
  const middle: number[] = [];
  let below = new Map(boards.map((b) => [b, cut(nodes, paths, b, 0)]));
  for (let k = 1; k < 40; k++) {
    const B = Math.round(D * STEP ** k);
    const top = cut(nodes, paths, root, B);
    if (!top.boxes.some(isGroup)) break; // the root opens to files: this budget is Everything
    const here = new Map(boards.map((b) => [b, cut(nodes, paths, b, B)]));
    if (boards.some((b) => !same(here.get(b)!, below.get(b)!))) { middle.push(B); below = here; }
  }
  const out: StopDef[] = [{ key: "everything", budget: Infinity, label: "More" }];
  for (let i = middle.length - 1; i >= 0; i--) out.push({ key: `+${i + 1}`, budget: middle[i], label: "" });
  out.push({ key: "default", budget: 0, label: "Default" });
  if (Object.values(nodes).some((n) => (n as Node).fine)) out.push({ key: "simple", budget: 0, label: "Less" });
  return out;
}
