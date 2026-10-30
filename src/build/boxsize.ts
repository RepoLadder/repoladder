// Box sizes, labels and the pick among layout candidates: the parts of layout.ts with no D2 in them,
// so the page can size and pick the boards it lays out itself (viewer/stoplayout.ts).
import type { Board, Model, ModelEdge } from "../model/rollup.ts";
import type { BoardLayout } from "./layout.ts";
import { fileBoxSizes, isFileBoard } from "./filelayout.ts";
import { partSub } from "../viewer/weight.ts";
import { STORY, plural, storeVerb } from "../viewer/state.ts";
import { ICON_ROOM } from "../viewer/shapes.ts";
import { whereLine } from "../viewer/where.ts";
import { isStoreBoard, storeBoxSizes } from "./storelayout.ts";
import { actorBox, laneWidth, storyCard } from "./storylayout.ts";
import type { LaneOpts } from "./lane.ts";
import { overlapPairs } from "./outline.ts";
import { NAME_CH, NAME_LINE, TEXT_PAD, WRAP_MIN, nameLines, splitName } from "../viewer/namewrap.ts";

export { storeVerb };

/** A board by id, including the story level (STORY), which lives in model.story rather than model.boards. */
export const boardOf = (model: Model, id: string): Board => (id === STORY ? model.story!.board : model.boards[id]);

/** The one line inside a store's cylinder: how many collections it has on this board (names live in the panel and the store's board, #326). */
export function storeLines(model: Model, id: string, boardId: string): string[] {
  const cols = boardOf(model, boardId).collections?.[id] ?? [];
  // file boards carry no per-board collection list: count the whole store rather than claim none
  return [plural(cols.length || Object.keys(model.stores?.[id] ?? {}).length, "collection")];
}

/** The text drawn on an arrow: only what a store arrow does. Counts live in the connection panel. */
export const edgeLabel = (e: ModelEdge): string => storeVerb(e);

/** Lines under a box's name, as the viewer and the export draw them. */
export function subLines(model: Model, id: string, boardId?: string): string[] {
  if (id.startsWith("store-") && boardId) return storeLines(model, id, boardId);
  if (model.services[id]) return [model.does?.[id] ?? "service"];
  if (boardId && boardOf(model, boardId).context.includes(id)) return [whereLine(model.nodes, boardId, id)];
  const n = model.nodes[id];
  return n ? [partSub(n.count, n.loc)] : [];
}

export const subLabel = (model: Model, id: string, boardId?: string) => subLines(model, id, boardId).join("\n");

// Rough advance width of the sub lines' font (board.css): 11px Geist Mono (0.6em a glyph). Names: namewrap.ts.
const SUB_CH = 6.7;

const nameOf = (model: Model, id: string) => model.services[id] ?? model.nodes[id]?.name ?? id;
/** Room for the backend kind's server rail beside the text (shapes.ts). */
export const railOf = (model: Model, id: string) => (model.nodes[id]?.kind === "backend" ? 12 : 0);

/**
 * A box's own size: room for its name and sub lines as shapes.ts draws them
 * (padding, the web top bar, the server rail, a cylinder's lid). D2's own text metrics are ignored.
 * With `wrap`, a long part name is measured on two lines (namewrap.ts); partSizes adds their height.
 */
export function baseSize(model: Model, boardId: string, id: string, wrap = false): [number, number] {
  const name = nameOf(model, id), subs = subLines(model, id, boardId);
  const svc = !!model.services[id], split = wrap && !svc && name.length >= WRAP_MIN ? splitName(name) : null;
  const text = Math.max(...(split ?? [name]).map((t) => t.length * NAME_CH), ...subs.map((s) => s.length * SUB_CH));
  const rail = railOf(model, id);
  const lines = 15 * Math.max(0, subs.length - 1);
  return svc ? [Math.ceil(Math.max(104, text + TEXT_PAD)), 74 + lines + (model.categories?.[id] ? ICON_ROOM : 0)] : [Math.ceil(Math.max(120, text + TEXT_PAD + rail)), 58 + lines];
}

/** One size for a group of boxes: the largest width and height among them. */
const common = (sizes: [number, number][]): [number, number] => sizes.reduce<[number, number]>((m, [w, h]) => [Math.max(m[0], w), Math.max(m[1], h)], [0, 0]);

/**
 * Final box sizes on a board, uniform by kind: every part and context box shares one size, from the
 * longest name and sub lines among them; services share another, and data stores a third. On a leaf's
 * board, file boxes share one size and context boxes another. Story actors keep their own medallion
 * size. Code volume reads from the sub line, not the box: the owner found varied sizes messier.
 */
export function boxSizes(model: Model, boardId: string, lane: LaneOpts | false = false, wrap = false): Record<string, [number, number]> {
  if (isStoreBoard(model, boardId)) return storeBoxSizes(model, boardId);
  if (boardId !== STORY) return partSizes(model, boardId, lane);
  const b = boardOf(model, boardId), actors = b.nodes.filter((id) => !!model.story!.actors[id]);
  const card = actorBox(storyCard(actors.map((id) => model.story!.actors[id]), b.edges), laneWidth(b.edges));
  return partSizes(model, boardId, lane, Object.fromEntries(actors.map((id) => [id, card])), wrap);
}

/**
 * boxSizes on a group or file board (the page's stop boards are only these, viewer/stoplayout.ts).
 * `fixed` boxes (the story's actors) keep the size given. With `wrap` (the story level only), the
 * parts' shared width is measured with long names on two lines, and the parts get a line's more
 * height if any name no longer fits that width on one (draw.ts splits those).
 */
export function partSizes(model: Model, boardId: string, lane: LaneOpts | false, fixed: Record<string, [number, number]> = {}, wrap = false): Record<string, [number, number]> {
  const b = boardOf(model, boardId), out: Record<string, [number, number]> = {};
  const files = isFileBoard(model, boardId) ? fileBoxSizes(model, boardId) : {};
  const actor = (id: string) => !!fixed[id];
  const own = (id: string) => files[id] ?? baseSize(model, boardId, id);
  const store = (id: string) => id.startsWith("store-");
  // Stores get their own size so a long store name doesn't stretch every service. Context boxes on a file
  // board carry a long "outside …" line and would stretch every short file name; in a lane (lane.ts)
  // they stand apart from the parts anyway, so they get their own size on every board.
  const apart = (id: string) => (lane || isFileBoard(model, boardId)) && b.context.includes(id);
  const groups = [
    b.nodes.filter((id) => !model.services[id] && !actor(id) && !apart(id)),
    b.nodes.filter(apart),
    b.nodes.filter((id) => model.services[id] && !store(id)),
    b.nodes.filter((id) => model.services[id] && store(id)),
  ];
  groups.forEach((group, g) => {
    const size = common(group.map((id) => (g === 0 && wrap && !files[id] ? baseSize(model, boardId, id, true) : own(id))));
    if (g === 0 && wrap && group.some((id) => nameLines(nameOf(model, id), size[0], railOf(model, id)).length > 1)) size[1] += NAME_LINE;
    for (const id of group) out[id] = size;
  });
  return Object.assign(out, fixed);
}

/**
 * A polyline without repeated points: ELK can emit a bend twice (seen with lane containers, lane.ts),
 * and a zero-length segment makes the viewer's rounded corners (curves.ts roundPath) divide by zero.
 */
export function bendsOnly(p: number[]): number[] {
  const out = p.slice(0, 2);
  for (let i = 2; i < p.length; i += 2) if (p[i] !== out[out.length - 2] || p[i + 1] !== out[out.length - 1]) out.push(p[i], p[i + 1]);
  return out.length >= 4 ? out : p;
}

/** The board canvas on a 1280×800 desktop (styles.css), and the box name size at 1:1. */
export const CANVAS = [905, 608];
/** Box name size at 1:1 (board.css). */
export const NAME_PX = 14.5;
const PAD = 24;
/** Rendered size of a box name when the layout is fitted to the canvas, as the viewer does on open. */
export function namePx(layout: BoardLayout): number {
  const xs: number[] = [], ys: number[] = [];
  for (const [, x, y, w, h] of layout.n) { xs.push(x, x + w); ys.push(y, y + h); }
  for (const [, , , ...p] of layout.e) for (let i = 0; i < p.length; i += 2) { xs.push(p[i]); ys.push(p[i + 1]); }
  const w = Math.max(...xs) - Math.min(...xs) + 2 * PAD, h = Math.max(...ys) - Math.min(...ys) + 2 * PAD;
  return NAME_PX * Math.min(1, CANVAS[0] / w, CANVAS[1] / h);
}

/**
 * The candidate that fills the screen best: the largest name size at fit, among those with the
 * fewest wires drawn over each other. Ties keep the earlier candidate (less spread, then "right"),
 * so a bigger spread has to actually buy readability.
 */
export function pickLayout(all: BoardLayout[]): BoardLayout {
  const lap = all.map(overlapPairs), least = Math.min(...lap), cands = all.filter((_, i) => lap[i] === least);
  let best = cands[0], px = namePx(best);
  for (const c of cands.slice(1)) {
    const p = namePx(c);
    if (p > px + 0.01) [best, px] = [c, p];
  }
  return best;
}
