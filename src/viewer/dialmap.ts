// What the detail dial (dial.ts) keeps when it turns: the selection, mapped onto the board now shown,
// where a turn lands when it removes your board (#327), and which of this repo's stops (budget.ts stopsFor) a remembered stop lands on. Pure: no DOM, so
// tests run it in Node.
import { drawnHolder, type Cut } from "./budget.ts";
import type { StopBoard } from "./stops.ts";
import type { PageNode } from "./state.ts";

/**
 * Board `id` as drawn, read as a cut: its containers are its opened groups (a board of containers,
 * cutboard.ts), every other box on it closed. A Default board is the cut that opens nothing.
 */
export function drawnCut(id: string, b: StopBoard): Cut {
  const held = new Set(Object.values(b.inside ?? {}));
  const open: Record<string, string[]> = { [id]: [] };
  for (const c of held) open[c] = [];
  return { board: id, budget: 0, open, boxes: b.nodes.filter((x) => !held.has(x)) };
}

/**
 * The selection after a turn, on board `id` now shown: the box itself if it's drawn, else the drawn
 * box or container that holds it (budget.ts drawnHolder); an arrow maps both ends and stays only if
 * that arrow is drawn. Null when it has no place here.
 */
export function mapHit(hit: string | null, id: string, b: StopBoard, tree: Record<string, PageNode>, paths: string[]): string | null {
  const c = drawnCut(id, b);
  const at = (x: string) => { const h = drawnHolder(c, tree, paths, x); return h === id ? null : h; };
  if (hit?.startsWith("n:")) { const x = at(hit.slice(2)); return x ? `n:${x}` : null; }
  if (!hit?.startsWith("e:")) return null;
  const [p, q] = hit.slice(2).split(">").map(at);
  return p && q && b.edges.some((e) => e.a === p && e.b === q) ? `e:${p}>${q}` : null;
}

/**
 * The stop a remembered `repoladder.detail` value lands on, among this repo's stop keys (top to
 * bottom). It is stored relative to Default (docs/detail-dial-v2.md), since repos have different
 * numbers of stops: `+k` past this repo's range lands on its top middle stop, or on Default when it
 * has none; a stop this page lacks (Simple without splits) lands on Default. The old `detailed`
 * reads as `+1`.
 */
export function landOn(stored: string | null, keys: string[]): string {
  const s = stored === "detailed" ? "+1" : stored;
  if (!s || keys.includes(s)) return s ?? "default";
  const k = /^\+(\d+)$/.exec(s);
  if (!k) return "default";
  const mid = keys.filter((x) => x.startsWith("+")).sort((a, b) => Math.abs(+a.slice(1) - +k[1]) - Math.abs(+b.slice(1) - +k[1]));
  return mid[0] ?? "default";
}

/** The board a stop is asked to open on: the story level ("_story") on a page without one (`--default`) is the root, #271. */
export const landAt = (at: string | undefined, hasStory: boolean): string | undefined => (at === "_story" && !hasStory ? "root" : at);

/** The stop one step from `at` (-1: up, toward Everything), or null at an end. */
export function stepFrom(keys: string[], at: string, dir: -1 | 1): string | null {
  const i = keys.indexOf(at) + dir;
  return keys.indexOf(at) >= 0 && i >= 0 && i < keys.length ? keys[i] : null;
}

/** Where you were before a turn took your board away (#327): kept across turns, cleared by any other move. */
export interface Jump { board: string; hit: string | null; view: number[]; stop: string }

/**
 * Where a turn lands (#327). `layer(id)` is the board that exists for `id` at the new stop, and
 * `same(id)` is `id` as Default names it. The target is the nearest layer of your board, or of the
 * pre-jump one while a jump is remembered. `restore` is true when that is the remembered board
 * itself, and then the memory is spent. A turn that moves you off your board starts one.
 */
export function landTurn(cur: Jump, jump: Jump | null, layer: (id: string) => string, same: (id: string) => string): { board: string; restore: boolean; jump: Jump | null } {
  const want = jump ?? cur, board = layer(want.board), restore = !!jump && board === jump.board;
  return { board, restore, jump: restore ? null : jump ?? (board !== same(cur.board) ? cur : null) };
}

/** A tour step played on `board` (#327) when its own board has no layer at its stop: its lit boxes and arrows become the drawn boxes that hold them. */
export function mapStep<S extends { board: string; lit: { boxes: string[]; edges: [string, string][] } }>(s: S, board: string, b: StopBoard, tree: Record<string, PageNode>, paths: string[]): S {
  const c = drawnCut(board, b);
  const at = (x: string) => (b.nodes.includes(x) ? x : drawnHolder(c, tree, paths, x) === board ? null : drawnHolder(c, tree, paths, x));
  const boxes = new Set<string>(), edges: [string, string][] = [];
  for (const x of s.lit.boxes) { const h = at(x); if (h) boxes.add(h); }
  for (const [x, y] of s.lit.edges) {
    const p = at(x), q = at(y);
    if (p && q && p !== q) edges.push([p, q]);
    for (const h of [p, q]) if (h) boxes.add(h);
  }
  return { ...s, board, lit: { boxes: [...boxes], edges } };
}
