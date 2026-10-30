// Layouts for the detail dial's stops, made in the page on demand and kept for the session. A board
// a stop draws as Default does keeps its Default layout, which the build laid out with D2 and
// linted. A Simple board that differs is laid out by elkjs (build/engines/elkboard.ts: the build's
// sizes and 8-candidate search); a board cut at a box budget (docs/detail-dial-v2.md) with its
// containers (everylayout.ts). Both run in a Worker (elkload.ts).
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { BoardLayout } from "../build/layout.ts";
import type { ModelEdge } from "../model/rollup.ts";
import { edgeLabel, partSizes } from "../build/boxsize.ts";
import { elkBoard } from "../build/engines/elkboard.ts";
import { laneSides } from "../build/lane.ts";
import { EVERY_GAP, everyGraphs, everyLayout, laneBoxes, type EveryOpts } from "./everylayout.ts";
import { CANVAS_ASPECT, laneSide, repack, type LaneSide } from "./everyfit.ts";
import { runElk } from "./elkload.ts";
import { rollStop, type Stop, type StopBoard, type StopData } from "./stops.ts";
import type { Cut } from "./budget.ts";
import { cutBoard } from "./cutboard.ts";
import { stopModel, type StopModel } from "./stopmodel.ts";
import type { ViewerData } from "./state.ts";

/** Runs one ELK graph: elkload.ts's Worker in the page, elkjs itself in tests. */
export type ElkRun = (g: ElkNode) => Promise<ElkNode>;

interface Cache { stop: StopData; sm?: StopModel; laid: Map<string, Promise<BoardLayout>> }
const caches = new WeakMap<ViewerData, Map<Stop, Cache>>();

function cache(data: ViewerData, stop: Stop): Cache {
  let m = caches.get(data);
  if (!m) caches.set(data, (m = new Map()));
  let c = m.get(stop);
  if (!c) m.set(stop, (c = { stop: rollStop(data, stop), laid: new Map() }));
  return c;
}
const modelOf = (data: ViewerData, c: Cache) => (c.sm ??= stopModel(data, c.stop));

/** A stop's tree and boards (stops.ts rollStop), rolled up once per page. */
export const stopData = (data: ViewerData, stop: Stop): StopData => cache(data, stop).stop;

/**
 * The Default layout, when the stop draws this board exactly as Default does: the same object
 * (story, store and untouched file boards pass through), or the same boxes in the same order, the
 * same drawn arrows and labels, and boxes of the same size. Otherwise null: it needs ELK.
 */
export function reusedLayout(data: ViewerData, stop: Stop, id: string): BoardLayout | null {
  const c = cache(data, stop), b = c.stop.boards[id], d = data.boards[id], l = data.layout[id];
  if (!b || !d || !l) return null;
  if (b === d) return l;
  const drawn = (x: typeof b) => x.edges.filter((e) => e.major).map((e) => `${e.a}>${e.b}:${edgeLabel(e as unknown as ModelEdge)}`).sort().join("\n");
  if (b.nodes.join("\n") !== d.nodes.join("\n") || b.context.join("\n") !== d.context.join("\n") || drawn(b) !== drawn(d)) return null;
  const { model, pageId } = modelOf(data, c), sizes = partSizes(model, id, laneSides(model, id).size ? { mode: "edge" } : false);
  const size = new Map(Object.entries(sizes).map(([k, s]) => [pageId(k), s]));
  // D2 rounds each box to whole units at its spread, so a box can come back a unit off
  return l.n.every(([k, , , w, h]) => { const s = size.get(k); return !!s && Math.abs(s[0] - w) <= 1 && Math.abs(s[1] - h) <= 1; }) ? l : null;
}

/**
 * A board of Simple, laid out: the Default layout where it can stand (reusedLayout), otherwise
 * elkjs. Asked again, it returns the same promise. Rejects when elkjs can't be loaded (elkload.ts ELK_NOTE).
 */
export function stopLayout(data: ViewerData, stop: Stop, id: string, run: ElkRun = runElk): Promise<BoardLayout> {
  const c = cache(data, stop);
  let p = c.laid.get(id);
  if (p) return p;
  const reused = reusedLayout(data, stop, id);
  if (reused) p = Promise.resolve(reused);
  else if (!c.stop.boards[id]) p = Promise.reject(new Error(`no board ${id} in ${stop}`));
  else {
    const { model, toPage } = modelOf(data, c);
    p = elkBoard(model, id, run).then(toPage);
  }
  c.laid.set(id, p);
  // a failed load can be retried later (the network may come back)
  p.catch(() => c.laid.delete(id));
  return p;
}

/**
 * A board of containers laid out to fill a canvas of shape `o.aspect` (everyfit.ts): both of
 * everyGraphs' candidates, each packed a few more ways, and the one whose boxes cover most of the
 * canvas at the fit wins (ties keep the earlier).
 */
async function fitted(data: ViewerData, b: StopBoard, o: EveryOpts & { aspect: number; side: LaneSide }, run: ElkRun): Promise<BoardLayout> {
  const gs = everyGraphs(data, data.nodes, b, o), lane = laneBoxes(data, b, o);
  let best: ElkNode | null = null, top = -1;
  for (const [i, r] of (await Promise.all(gs.map(run))).entries()) {
    const opts = new Map<string, ElkNode["layoutOptions"]>();
    const index = (n: ElkNode) => { opts.set(n.id, n.layoutOptions); n.children?.forEach(index); };
    index(gs[i]);
    const [cand, s] = repack(r, opts, o.aspect, lane, EVERY_GAP, o.side);
    if (s > top + 1e-6) [best, top] = [cand, s];
  }
  return everyLayout(data, b, best!, o);
}

const cuts = new WeakMap<ViewerData, Map<string, { board: StopBoard; laid: Promise<BoardLayout> }>>();

/**
 * A cut's board and its layout (docs/detail-dial-v2.md), made once per (board, budget). A cut
 * that opens nothing is the Default board, with its D2 layout; any other is laid out with its
 * containers (everylayout.ts) in elkload.ts's Worker. Rejects when elkjs can't be loaded.
 */
export function cutLayout(data: ViewerData, c: Cut, run: ElkRun = runElk, o: EveryOpts = {}): { board: StopBoard; laid: Promise<BoardLayout> } {
  let m = cuts.get(data);
  if (!m) cuts.set(data, (m = new Map()));
  // what it opens is in the key too, so a cut made by hand (tests, experiments) never takes another's
  const aspect = o.aspect ?? CANVAS_ASPECT, side = o.side ?? laneSide(aspect);
  const key = `${c.board}@${c.budget}:${Object.keys(c.open).sort().join(",")}:${o.lane ?? "edge"}:${aspect}:${side}`;
  let got = m.get(key);
  if (got) return got;
  if (Object.keys(c.open).length === 1 && data.layout[c.board] && data.boards[c.board]) got = { board: data.boards[c.board], laid: Promise.resolve(data.layout[c.board]) };
  else {
    const b = cutBoard(data, c);
    got = { board: b, laid: fitted(data, b, { ...o, aspect, side }, run) };
  }
  m.set(key, got);
  // a failed load can be retried later (the network may come back)
  got.laid.catch(() => m.delete(key));
  return got;
}
