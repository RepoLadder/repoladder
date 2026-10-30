// The story level (Overview) at a box budget (docs/detail-dial-v2.md). The story board is not a
// group: it is the root's board plus the actors and what they use. So at a budget stop it is the
// root's cut (budget.ts cut), its actors and services counted as `extra` like any board's lane.
// Each story part is a level-1 group, so parts never overlap. The parts are laid out as any cut
// (everylayout.ts); the actors then stand in a column on the left, as on the story as built, each
// arrow leaving straight right with room for its pill, then along the gutters. A cut that opens
// nothing is the story as built, with its D2 layout.
import type { BoardLayout } from "../build/layout.ts";
import { cut, extraBoxes } from "./budget.ts";
import { EVERY_GAP, type EveryOpts } from "./everylayout.ts";
import { sayBox, soleSay } from "./figures.ts";
import { routeGutters, type Rect } from "./gutters.ts";
import { runElk } from "./elkload.ts";
import { cutLayout, type ElkRun } from "./stoplayout.ts";
import type { StopBoard } from "./stops.ts";
import { STORY, type ViewerData } from "./state.ts";

/** Room on each side of the pill on an actor's arrow. */
const PAD = 14;

/** The story board for the root's board `b` at a budget: its top renamed to STORY, and the actors and their arrows added. */
function storyBoard(data: ViewerData, b: StopBoard): StopBoard {
  const sb = data.boards[STORY], actors = data.story!.actors, inside: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.inside!)) inside[k] = v === "root" ? STORY : v;
  const cast = sb.nodes.filter((id) => actors[id]);
  for (const a of cast) inside[a] = STORY;
  return { ...b, nodes: [...cast, ...b.nodes], edges: [...sb.edges.filter((e) => actors[e.a]), ...b.edges], inside, cut: { board: STORY, budget: b.cut!.budget } };
}

/** Sets the actors in a column left of the laid-out parts, each level with what it uses where the column allows, and routes their arrows. */
function placeCast(data: ViewerData, b: StopBoard, l: BoardLayout): BoardLayout {
  const actors = data.story!.actors, told = b.edges.filter((e) => actors[e.a]);
  const tops: Record<string, Rect> = {};
  for (const [id, x, y, w, h] of l.n) if (b.inside![id] === STORY) tops[id] = { x, y, w, h };
  const rs = Object.values(tops), x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  const size = (id: string) => data.layout[STORY].n.find((r) => r[0] === id)!.slice(3, 5) as number[];
  const aim = (a: string) => { const t = tops[told.find((e) => e.a === a)?.b ?? ""]; return t ? t.y + t.h / 2 : 0; };
  const order = b.nodes.filter((id) => actors[id]).sort((p, q) => aim(p) - aim(q));
  const pill = Math.max(...told.map((e) => sayBox(e.says!, soleSay(told, e.a))[0])) + 2 * PAD;
  const w = Math.max(...order.map((a) => size(a)[0])), stubX = x0 - EVERY_GAP - 2, ax = stubX - pill - w;
  let y = (y0 + y1) / 2 - (order.reduce((s, a) => s + size(a)[1], 0) + EVERY_GAP * (order.length - 1)) / 2;
  const n: BoardLayout["n"] = [], box: Record<string, Rect> = { ...tops }, at: Record<string, Rect> = {};
  const from = new Map<object, number>();
  for (const a of order) {
    const [aw, ah] = size(a);
    // the actor is in the way of other wires; its arrow leaves from a stub past the pill's room
    box[`#${a}`] = at[a] = { x: ax + w - aw, y, w: aw, h: ah };
    box[`>${a}`] = { x: stubX, y, w: 2, h: ah };
    n.push([a, ax + w - aw, y, aw, ah, 0]);
    // its arrows' pills stack 4px apart around its middle, as build/storylayout.ts ports, in the order of what they aim at
    const mine = told.filter((e) => e.a === a).sort((p, q) => (tops[p.b]?.y ?? 0) - (tops[q.b]?.y ?? 0));
    const hs = mine.map((e) => sayBox(e.says!, soleSay(told, a))[1]);
    let py = y + (ah - hs.reduce((t, h) => t + h + 4, -4)) / 2;
    mine.forEach((e, k) => { from.set(e, py + hs[k] / 2); py += hs[k] + 4; });
    y += ah + EVERY_GAP;
  }
  const routes = routeGutters(box, told.map((e) => [`>${e.a}`, e.b]), EVERY_GAP / 2);
  const e: BoardLayout["e"] = [];
  told.forEach((ed, i) => {
    const r = routes[i], a = at[ed.a], cy = from.get(ed)!;
    if (r.length >= 4) e.push([ed.a, ed.b, 0, a.x + a.w, cy, ...(r[1] === cy ? [] : [r[0], cy]), ...r]);
  });
  return { n: [...n, ...l.n], e: [...e, ...l.e] };
}

/** Where an actor's pill sits on a cut story (placeCast left it room): beside the actor, on its arrow's straight start. */
export const castPill = (p: number[], says: string[], alone: boolean) => ({ x: p[0] + sayBox(says, alone)[0] / 2 + PAD, y: p[1] });

/**
 * The story board at `budget` and its layout: the root's cut (stoplayout.ts cutLayout, which caches
 * it; `o.aspect` is the canvas's shape, and its services sit at the right or bottom edge, everyfit.ts),
 * its actors and services counted as `extra`, then the actors set in place. A cut that opens
 * nothing is the story as built.
 */
export function storyLayout(data: ViewerData, budget: number, run: ElkRun = runElk, o: EveryOpts = {}): { board: StopBoard; laid: Promise<BoardLayout> } {
  const sb = data.boards[STORY], got = cutLayout(data, cut(data.tree ?? data.nodes, data.paths, "root", budget, { extra: extraBoxes(data.nodes, sb, "root") }), run, o);
  if (got.board === data.boards.root) return { board: sb, laid: Promise.resolve(data.layout[STORY]) };
  const b = storyBoard(data, got.board);
  return { board: b, laid: got.laid.then((l) => placeCast(data, b, l)) };
}
