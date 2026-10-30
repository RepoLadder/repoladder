import type { Model } from "../model/rollup.ts";
import { isFileBoard } from "./filelayout.ts";
import { STORY } from "../viewer/state.ts";
import { d2Pool } from "./d2pool.ts";
import { boardKey, verifyLayout, type LayoutSession } from "./layoutsession.ts";
import { isStoreBoard, storeLayout } from "./storelayout.ts";
import { fitActors, pillHeights, storyCard } from "./storylayout.ts";
import { orderRanges } from "./rangeorder.ts";
import { STACK_PAD, isStacked, separateWires, snapWires, throughWires } from "./outline.ts";
import { cylPad, fitCylinders } from "./cylgap.ts";
import { lintBoard } from "./lint.ts";
import { LANES, isLaneLayoutEdge, isSpacer, laneAtEdge, laneOrder, laneSides, spacerSize, unLane, wideLanes, withLanes, type LaneMode, type LaneOpts } from "./lane.ts";
import { addStats, bump, dedupe, type LayoutStats } from "./layoutstats.ts";
import { NAME_PX, bendsOnly, boardOf, boxSizes, edgeLabel, namePx, pickLayout } from "./boxsize.ts";

export { CANVAS, baseSize, bendsOnly, boardOf, boxSizes, edgeLabel, namePx, pickLayout, storeLines, storeVerb, subLabel, subLines } from "./boxsize.ts";

/**
 * Compact layout for one board: nodes [id, x, y, w, h, isService] and edge routes
 * [a, b, isCurve, ...points]. Curved routes are cubic béziers: start, then (c1, c2, end) triples.
 */
export interface BoardLayout {
  n: [string, number, number, number, number, 0 | 1][];
  e: [string, string, 0 | 1, ...number[]][];
}

const q = (s: string) => JSON.stringify(s);

/**
 * On the story level the actors sit in one invisible D2 container. ELK lays a container's children out on
 * their own, and with no edges among them they form one column in the order they are declared (the
 * grouping's order) instead of moving right toward their targets. layoutBoards drops the container.
 */
export const ACTORS = "story-actors";
const inCol = (id: string) => `${q(ACTORS)}.${q(id)}`;

/**
 * D2 source used for LAYOUT ONLY: every box has an explicit size (boxSizes), multiplied by `spread`.
 * D2's gaps between boxes are fixed, so laying out bigger boxes and scaling the result back down by
 * `spread` (layoutBoards) tightens the gaps relative to the boxes and their text. Boxes carry no label:
 * the viewer draws its own text, and a D2 label taller than its box makes ELK route the box's wires
 * from a bigger box than the one it reports. An openable box reserves room for its stacked cards
 * (STACK_PAD right and down), so neighbours and wires keep clear of them; layoutBoards gives the
 * front card back its own size. `wrap` sizes the story's parts for long names on two lines (boxSizes).
 */
export function d2Source(model: Model, boardId: string, direction: "right" | "down" = "right", spread = 1, bare = new Set<string>(), lane: LaneOpts | false = false, cylGap?: number, wrap = false): string {
  if (isFileBoard(model, boardId)) return fileD2Source(model, boardId, direction, spread, bare, lane, cylGap);
  const b = boardOf(model, boardId), size = boxSizes(model, boardId, lane, wrap);
  let src = `direction: ${direction}\n`;
  for (const id of b.nodes) {
    const actor = boardId === STORY ? model.story!.actors[id] : undefined;
    if (actor) {
      src += `${inCol(id)}: "" { width: ${Math.round(size[id][0] * spread)}; height: ${Math.round(size[id][1] * spread)} }\n`;
      continue;
    }
    const pad = isStacked(model, boardId, id) ? STACK_PAD : 0, [w, h] = size[id], cyl = cylPad(model, boardId, id, direction, spread, !!lane, cylGap);
    src += `${q(id)}: "" { width: ${Math.round((w + pad) * spread)}; height: ${Math.round((h + pad + cyl) * spread)}${model.services[id] ? "; shape: cylinder" : ""} }\n`;
  }
  for (const e of b.edges) {
    if (!e.major) continue;
    // The story level reserves no room for labels: what actors do sits in the lane beside them
    // (storylayout.ts), and the code arrows' labels are hidden there (styles.css).
    const label = boardId === STORY || bare.has(`${e.a}>${e.b}`) ? "" : edgeLabel(e);
    const end = (id: string) => (boardId === STORY && model.story!.actors[id] ? inCol(id) : q(id));
    src += `${end(e.a)} -> ${end(e.b)}${label ? `: ${q(label)}` : ""}\n`;
  }
  if (src.includes(`${q(ACTORS)}.`)) src += `${q(ACTORS)}.label: ""\n`;
  return lane ? withLanes(model, boardId, src, q, lane, spacerSize(direction, spread)) : src;
}

/**
 * File boards alias every id to n<index>: paths hold dots and slashes, which D2 reads as
 * structure. `layoutBoards` maps the aliases back. Boxes get explicit sizes like group boards.
 */
function fileD2Source(model: Model, boardId: string, direction: "right" | "down", spread: number, bare: Set<string>, lane: LaneOpts | false, cylGap?: number): string {
  const b = model.boards[boardId], size = boxSizes(model, boardId, lane);
  const alias = new Map(b.nodes.map((id, i) => [id, `n${i}`]));
  let src = `direction: ${direction}\n`;
  for (const id of b.nodes) {
    const pad = isStacked(model, boardId, id) ? STACK_PAD : 0, [w, h] = size[id], cyl = cylPad(model, boardId, id, direction, spread, !!lane, cylGap);
    src += `${alias.get(id)}: "" { width: ${Math.round((w + pad) * spread)}; height: ${Math.round((h + pad + cyl) * spread)}${model.services[id] ? "; shape: cylinder" : ""} }\n`;
  }
  for (const e of b.edges) {
    if (!e.major) continue;
    const label = bare.has(`${e.a}>${e.b}`) ? "" : edgeLabel(e);
    src += `${alias.get(e.a)} -> ${alias.get(e.b)}${label ? `: ${q(label)}` : ""}\n`;
  }
  return lane ? withLanes(model, boardId, src, (id) => alias.get(id)!, lane, spacerSize(direction, spread)) : src;
}

/** Whether sizing the story for two-line names changes anything (boxSizes). */
const wrapsAny = (model: Model) => JSON.stringify(boxSizes(model, STORY, false, true)) !== JSON.stringify(boxSizes(model, STORY));

const SPREADS = [1, 1.4, 1.8, 2.2, 2.6, 3, 3.5, 4];
// file boards are most of the boards: coarser steps keep build time down
const FILE_SPREADS = [1, 2, 3];
const DIRECTIONS = ["right", "down"] as const;

/**
 * Lays out every board with ELK, trying each direction at each spread and keeping the one whose names
 * read biggest when fitted to the canvas (pickLayout); the search stops early only once a candidate
 * fits at full size, since nothing can beat that. Boards and candidates run in parallel on a pool of
 * D2 workers (d2pool.ts). Each board's choice depends only on its own compile results, which are pure
 * functions of their D2 source, so scheduling never changes the output. With `cacheDir`, compile
 * results are cached there and unchanged boards skip D2 entirely. Lanes (lane.ts) are on unless `lane: false`.
 * `cylGap` replaces CYL_GAP (cylgap.ts), for experiments. At most `maxBoards` boards are in flight
 * (default a few per worker): results are collected by index, so the cap never changes the output.
 * With `stats`, counts where the compiles go (layoutstats.ts); without it nothing is counted or timed.
 */
export async function layoutBoards(model: Model, opts: { cacheDir?: string; readOnlyCache?: boolean; lane?: boolean; only?: string[]; cylGap?: number; session?: LayoutSession; onBoard?: (done: number, total: number) => void; stats?: LayoutStats; maxBoards?: number } = {}): Promise<Record<string, BoardLayout>> {
  // with a session (one build's passes) the pool and the per-board memo are shared and the session closes the pool
  const pool = opts.session?.pool ?? d2Pool({ cacheDir: opts.cacheDir, readOnly: opts.readOnlyCache });
  const R = Math.round;
  const ids = Object.keys(model.boards).sort();
  if (model.story) ids.unshift(STORY);
  if (opts.only) ids.splice(0, ids.length, ...ids.filter((id) => opts.only!.includes(id)));
  const st = opts.stats;
  // time spent in the JS around the compiles, counted only with stats
  const js = <T,>(f: () => T): T => { if (!st) return f(); const t = performance.now(); try { return f(); } finally { st.jsMs += performance.now() - t; } };
  const fresh = async (id: string): Promise<BoardLayout> => {
    if (isStoreBoard(model, id)) return storeLayout(model, id); // a lattice of cells, nothing for D2 to route
    // The story reads left to right like a sentence: who, then what they use, then what that is built on.
    const dirs = id === STORY ? (["right"] as const) : DIRECTIONS;
    const fileBoard = isFileBoard(model, id);
    // file boards alias boxes to n<index>, inside a lane container when they are in one (lane.ts)
    const real = (x: string) => (fileBoard ? model.boards[id].nodes[Number(unLane(x).slice(1))] : x.startsWith(`${ACTORS}.`) ? x.slice(ACTORS.length + 1) : unLane(x));
    // with the lane option (lane.ts), every way of making the lanes is a candidate
    const sides = opts.lane !== false ? [...laneSides(model, id).keys()] : [];
    const modes: (LaneMode | false)[] = sides.length ? ["edge", "loose", "rows"] : [false];
    const compile = async (direction: "right" | "down", spread: number, lane: LaneOpts | false, wrap: boolean, bare?: Set<string>): Promise<BoardLayout> => {
      const src = js(() => d2Source(model, id, direction, spread, bare, lane, opts.cylGap, wrap));
      if (st) { bump(st.dir, direction); bump(st.spread, spread); bump(st.lane, lane ? lane.mode : "false"); }
      const t0 = st ? performance.now() : 0;
      const r = await pool.compile(src, "elk");
      if (st) st.d2Ms += performance.now() - t0;
      const s = (v: number) => R(v / spread);
      // an openable box's front card sits at the top left of the room D2 reserved for its stack
      const front = (sid: string, v: number) => s(v) - (isStacked(model, id, real(sid)) ? STACK_PAD : 0);
      // a cylinder is drawn its own height, in the middle of the taller room D2 reserved (cylgap.ts)
      const room = (sid: string) => cylPad(model, id, real(sid), direction, spread, !!lane, opts.cylGap);
      const raw: BoardLayout = {
        n: r.s.filter(([sid]) => sid !== ACTORS && !LANES.has(sid) && !isSpacer(sid)).map(([sid, x, y, w, h, cyl]) => [real(sid), s(x), s(y) + Math.floor(room(sid) / 2), front(sid, w), front(sid, h) - room(sid), cyl]),
        e: r.c.filter(([a, b]) => !LANES.has(a) && !LANES.has(b) && !isLaneLayoutEdge(a, b)).map(([a, b, curve, ...p]) => [real(a), real(b), curve, ...(curve ? p.map(s) : bendsOnly(p.map(s)))]),
      };
      const fitted = fitCylinders(raw, new Set(raw.n.filter((n) => n[5] && cylPad(model, id, n[0], direction, spread, !!lane, opts.cylGap)).map((n) => n[0])));
      return snapWires(model, id, separateWires(id === STORY ? fitActors(fitted, new Set(Object.keys(model.story!.actors)), storyCard(Object.values(model.story!.actors), model.story!.board.edges), pillHeights(model.story!.board.edges)) : orderRanges(model, id, fitted)));
    };
    // lanes are laid out twice: the first layout says in which order to declare the lane boxes. Two-row
    // lanes ("rows") start from the edge layout (the same compile, so a cache hit) and are tried only on
    // down-flowing boards where a lane is wider than the parts (wideLanes); elsewhere there is no candidate.
    const lay = async (direction: "right" | "down", spread: number, mode: LaneMode | false, wrap: boolean, bare?: Set<string>): Promise<BoardLayout | null> => {
      if (!mode) return compile(direction, spread, false, wrap, bare);
      if (mode === "rows" && direction !== "down") return null;
      const first = await compile(direction, spread, { mode: mode === "rows" ? "edge" : mode }, wrap, bare), order = laneOrder(model, id, first, direction);
      if (mode === "rows") {
        const rows = wideLanes(model, id, first);
        if (rows.length && st) st.laneSecond++;
        return rows.length ? compile(direction, spread, { mode, order, rows }, wrap, bare) : null;
      }
      if (order.join("\n") === sides.join("\n")) return first;
      if (st) st.laneSecond++;
      return compile(direction, spread, { mode, order }, wrap, bare);
    };
    // ELK can route a long labelled edge straight through a box in a middle layer (its label's dummy
    // node is placed over the box). Laying the board out again without those edges' labels routes
    // them around; the viewer still places their pills, wherever there is room (placement.ts).
    const clear = async (direction: "right" | "down", spread: number, lane: LaneMode | false, wrap: boolean): Promise<BoardLayout | null> => {
      // a loose lane counts only where it reached the board's edge
      const first = await lay(direction, spread, lane, wrap);
      if (!first) return null;
      const bad = js(() => throughWires(model, id, first));
      const edge = (l: BoardLayout) => (lane !== "loose" || laneAtEdge(model, id, l, direction) ? l : null);
      const lo = lane && { mode: lane };
      if (!bad.size || d2Source(model, id, direction, spread, bad, lo, opts.cylGap, wrap) === d2Source(model, id, direction, spread, new Set(), lo, opts.cylGap, wrap)) return edge(first);
      if (st) st.clearRetries++;
      const again = (await lay(direction, spread, lane, wrap, bad)) ?? first;
      return edge(js(() => throughWires(model, id, again).size) < bad.size ? again : first);
    };
    // the story's long part names may go on two lines, when narrower boxes let the board read bigger (#236)
    const wraps = id === STORY && wrapsAny(model) ? [false, true] : [false];
    // a candidate the lint finds no defect in beats a bigger one it does (a wire short of a box, a label on one)
    const clean = new Map<BoardLayout, boolean>();
    const isClean = (c: BoardLayout) => { if (!clean.has(c)) clean.set(c, js(() => !lintBoard(model, id, c).defects.length)); return clean.get(c)!; };
    const pick = (cs: BoardLayout[]) => { const ok = cs.filter(isClean); return pickLayout(ok.length ? ok : cs); };
    const cands: BoardLayout[] = [];
    // a later candidate equal to an earlier one can never be picked (pickLayout keeps the first of equals) and
    // would only be linted and measured again
    const seen = new Set<string>(), rungs = fileBoard ? FILE_SPREADS : SPREADS;
    let stopped = false;
    for (const [i, spread] of rungs.entries()) {
      const tries = await Promise.all(wraps.flatMap((wrap) => modes.flatMap((lane) => dirs.map((direction) => clear(direction, spread, lane, wrap)))));
      const { kept, dropped } = js(() => dedupe(tries.filter((c): c is BoardLayout => !!c), seen));
      if (st) st.dupes += dropped;
      cands.push(...kept);
      if (js(() => namePx(pick(cands))) >= NAME_PX) { stopped = true; if (st) bump(st.stopRung, i); break; }
    }
    if (st && !stopped) st.fullLadder++;
    return js(() => pick(cands));
  };
  let finished = 0;
  const layoutOne = async (id: string): Promise<BoardLayout> => {
    const r = await layoutBoard(id);
    opts.onBoard?.(++finished, ids.length);
    return r;
  };
  const layoutBoard = async (id: string): Promise<BoardLayout> => {
    const session = opts.session;
    if (!session || isStoreBoard(model, id)) return fresh(id);
    const k = boardKey(model, id, { lane: opts.lane !== false, cylGap: opts.cylGap }), memo = session.reuse.get(k);
    if (memo && !verifyLayout()) { session.stats.reused++; return structuredClone(memo); }
    const r = await fresh(id);
    if (memo && JSON.stringify(memo) !== JSON.stringify(r)) throw new Error(`LAYOUT_REUSE_MISMATCH ${id}`);
    if (memo) session.stats.reused++; else session.stats.laidOut++;
    session.reuse.set(k, structuredClone(r));
    return r;
  };
  try {
    const layouts = await inFlight(ids, opts.maxBoards ?? Math.max(8, pool.size * 4), layoutOne);
    return Object.fromEntries(ids.map((id, i) => [id, layouts[i]]));
  } finally {
    if (!opts.session) await pool.close();
  }
}

/** Maps `items` with at most `cap` calls running at once; results keep the items' order whatever the scheduling. */
export async function inFlight<T, R>(items: T[], cap: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  // after a failure the rest of the queue stays unstarted: the caller closes the pool as it unwinds
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { out[i] = await f(items[i]); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, worker));
  return out;
}
