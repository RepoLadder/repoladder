// Layout of store boards (see model/storeboards.ts); viewer/collections.ts draws the boxes. Every
// box sits on one lattice of rows: the readers and writers in a block on the left, the collections
// in a grid of same-size cells beside it. A collection with subcollections is a frame whose first
// row is its own name and whose cells below hold its subcollections, so rows line up across the
// whole board. The grid's shape is searched to fill the landscape canvas with the biggest boxes.
// Fields stay off the canvas (a collection box says how many) and are listed in the panel.
// D2 is not used: there are no arrows to route (the viewer draws the selection's), only cells to pack.
import { COLL, collLabel, parentColl } from "../model/storeboards.ts";
import type { Model } from "../model/rollup.ts";
import type { BoardLayout } from "./layout.ts";
import { plural } from "../viewer/state.ts";

export const isStoreBoard = (model: Model, boardId: string) => !!model.stores?.[boardId];

/** Box height: a name and one line under it, as on every other board. */
export const STORE_BOX_H = 44;
/** Gaps between cells (across, down), and between the readers/writers block and the collections. */
const GX = 18, GY = 22, GUTTER = 28;
/** A frame's padding around its cells, outermost first: under half of GX, so two frames side by side stay apart. */
const FRAME = [7, 3.5];
/** Padding of a collection's frame around its cells, by how deep it is nested. Shared with the viewer. */
export const framePad = (name: string) => { let d = 0; for (let p = parentColl(name); p; p = parentColl(p)) d++; return FRAME[Math.min(d, FRAME.length - 1)]; };
/** The 1280×800 desktop canvas (build/layout.ts CANVAS; not imported, so the viewer can share this file). */
const CANVAS = [905, 608], VIEW_PAD = 24;
/** Widest box. A collection name up to SQUEEZE times its room is drawn narrowed to fit; a longer one is cut with an ellipsis (the panel and tooltip have it whole). */
export const MAX_W = 260, SQUEEZE = 1.12;
/** Sub lines are 11px Geist Mono (0.6em a glyph); 10px of room each side of the text. */
const SUB_CH = 6.6, TEXT_PAD = 20;

// Glyph widths of 14.5px Geist at weight 650 (board.css .node .name), in tenths of a px,
// measured in Chromium (`node scripts/fonts.ts measure`): a flat per-character guess oversizes the narrow-lettered names most.
const LOWER = [84, 90, 84, 90, 85, 62, 90, 87, 38, 45, 91, 43, 129, 87, 87, 90, 90, 59, 80, 62, 86, 85, 121, 91, 83, 82];
const UPPER = [103, 100, 104, 102, 88, 86, 105, 103, 41, 89, 97, 84, 130, 107, 110, 95, 109, 99, 96, 84, 100, 103, 144, 96, 89, 84];
const DIGIT = [98, 62, 93, 92, 93, 95, 89, 77, 93, 89];
const OTHER: Record<string, number> = { " ": 33, "&": 99, "-": 59, "_": 80, "/": 73, ".": 32, "(": 44, ")": 44 };

/** Width of a box name in px, with a little to spare for a fallback font. Shared with the viewer. */
export function nameWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 97 && c <= 122 ? LOWER[c - 97] : c >= 65 && c <= 90 ? UPPER[c - 65] : c >= 48 && c <= 57 ? DIGIT[c - 48] : OTHER[ch] ?? 90;
  }
  return (w / 10) * 1.04;
}


/** The line under a collection's name: its field count, and how many subcollections it holds. */
export function collSub(fields: number, subs: number): string {
  return `${fields ? plural(fields, "field") : "no fields seen"}${subs ? ` · ${plural(subs, "subcollection")}` : ""}`;
}

/** Sub line of a reader/writer box on a store board: the top-level part it belongs to. */
export function partWhere(model: Model, id: string): string {
  const p = model.nodes[id]?.parent;
  return p && p !== "root" ? `in ${model.nodes[p].name}` : "part";
}

/**
 * Experimental knobs (LayoutOpts.store), off in the build: `fields` makes every
 * collection box tall enough to list that many field names under its count; `flat` packs
 * subcollections as plain cells beside their parent instead of inside its frame.
 */
export interface StoreOpts { fields?: number; flat?: boolean }
/** Height of one listed field name (11px mono sub lines), for StoreOpts.fields. */
export const FIELD_LINE_H = 15;

const kidsOf = (model: Model, boardId: string, flat = false) => {
  const kids = new Map<string, string[]>();
  for (const id of model.boards[boardId].nodes) {
    if (!id.startsWith(COLL)) continue;
    const p = flat ? null : parentColl(id.slice(COLL.length)), k = p ? COLL + p : "";
    kids.set(k, [...(kids.get(k) ?? []), id]);
  }
  return kids;
};

/**
 * One width per kind: every collection cell has room for the longest collection name (narrowed by up
 * to SQUEEZE) or count line, up to MAX_W; every reader/writer for the longest part name. All boxes share one height.
 * A frame's size comes from its cells (storeLayout); here it is sized as a cell.
 */
export function storeBoxSizes(model: Model, boardId: string, o: StoreOpts = {}): Record<string, [number, number]> {
  // the count line names the subcollections even when they are packed beside their parent
  const b = model.boards[boardId], kids = kidsOf(model, boardId), out: Record<string, [number, number]> = {};
  const text = (id: string): [string, string] => {
    if (!id.startsWith(COLL)) return [model.nodes[id]?.name ?? id, partWhere(model, id)];
    const name = id.slice(COLL.length);
    const fs = model.stores![boardId][name]?.fields ?? [];
    return [collLabel(name), [collSub(fs.length, kids.get(id)?.length ?? 0), ...fs.slice(0, o.fields ?? 0).map((f) => f.name)].reduce((a, l) => (l.length > a.length ? l : a), "")];
  };
  // one long collection name should not widen every cell: it is drawn a little narrower instead
  const width = (ids: string[], squeeze: number) => Math.min(MAX_W, Math.max(140, ...ids.map((id) => { const [n, s] = text(id); return Math.ceil(Math.max(nameWidth(n) / squeeze, s.length * SUB_CH) + TEXT_PAD); })));
  const cw = width(b.nodes.filter((id) => id.startsWith(COLL)), SQUEEZE), pw = width(b.context, 1);
  for (const id of b.nodes) out[id] = [id.startsWith(COLL) ? cw : pw, STORE_BOX_H + FIELD_LINE_H * (o.fields ?? 0)];
  return out;
}

type At = [id: string, c: number, r: number];
type Frame = [id: string, c: number, r: number, cols: number, rows: number];
/** Cells taken by a block: [column, row] from its top-left, for each box and each frame. */
interface Block { cols: number; rows: number; at: At[]; frames: Frame[] }

/**
 * First fit, row by row: the first cell from which the block's columns and rows are all free. A frame
 * also keeps off the sides of other frames: their paddings would leave the two borders almost touching.
 */
function place(taken: number[][], cols: number, w: number, h: number, isFrame: boolean): [number, number] {
  const at = (x: number, y: number) => taken[y]?.[x] ?? 0;
  for (let r = 0; ; r++) for (let c = 0; c + w <= cols; c++) {
    let ok = true;
    for (let y = r; ok && y < r + h; y++) for (let x = c; ok && x < c + w; x++) ok = !at(x, y);
    for (let y = r; ok && isFrame && y < r + h; y++) ok = at(c - 1, y) !== 2 && at(c + w, y) !== 2;
    for (let x = c; ok && isFrame && x < c + w; x++) ok = at(x, r - 1) !== 2 && at(x, r + h) !== 2;
    if (ok) {
      for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) (taken[y] ??= Array(cols).fill(0))[x] = isFrame ? 2 : 1;
      return [c, r];
    }
  }
}

/** Packs collections into `cols` columns: frames (biggest first), then plain boxes in name order. */
function pack(ids: string[], cols: number, kids: Map<string, string[]>, k: number): Block {
  const blocks = ids.map((id) => [id, kids.has(id) ? frame(id, cols, kids, k) : null] as const);
  const size = (b: Block | null) => (b ? b.cols * b.rows : 0);
  blocks.sort((x, y) => size(y[1]) - size(x[1]) || (x[0] < y[0] ? -1 : 1));
  const taken: number[][] = [], out: Block = { cols: 0, rows: 0, at: [], frames: [] };
  for (const [id, b] of blocks) {
    const [c, r] = place(taken, cols, b?.cols ?? 1, b?.rows ?? 1, !!b);
    if (!b) { out.at.push([id, c, r]); continue; }
    out.at.push(...b.at.map(([i, x, y]): At => [i, x + c, y + r]));
    out.frames.push(...b.frames.map(([i, x, y, w, h]): Frame => [i, x + c, y + r, w, h]));
  }
  out.rows = taken.length;
  out.cols = Math.max(0, ...taken.map((row) => row.reduce((n, v, x) => (v ? x + 1 : n), 0)));
  return out;
}

/** A collection with subcollections: its own name on the first row, its subcollections (at most k across) below. */
function frame(id: string, cols: number, kids: Map<string, string[]>, k: number): Block {
  const sub = kids.get(id)!, inner = pack(sub, Math.max(1, Math.min(cols, k, sub.length)), kids, k);
  const down = <T extends At | Frame>(t: T): T => { const c = [...t] as T; c[2] = (c[2] as number) + 1; return c; };
  return { cols: inner.cols, rows: inner.rows + 1, at: [[id, 0, 0], ...inner.at.map(down)], frames: [[id, 0, 0, inner.cols, inner.rows + 1], ...inner.frames.map(down)] };
}

/**
 * Tries every grid width, frame width and number of reader/writer columns, and keeps the one whose
 * board fits the desktop canvas at the biggest zoom (ties: the first tried, so it is deterministic).
 */
export function storeLayout(model: Model, boardId: string, o: StoreOpts = {}): BoardLayout {
  const b = model.boards[boardId], kids = kidsOf(model, boardId, o.flat), size = storeBoxSizes(model, boardId, o);
  const parts = b.context, top = kids.get("") ?? [];
  const [cw, h] = size[top[0]] ?? [140, STORE_BOX_H], pw = parts.length ? size[parts[0]][0] : 0;
  const px = cw + GX, py = h + GY, ppx = pw + GX;
  const most = Math.max(1, ...[...kids.values()].map((l) => l.length));
  let best: { s: number; grid: Block; pc: number } | null = null;
  for (let cols = 1; cols <= Math.min(most, 10); cols++) for (let k = 1; k <= cols; k++) {
    const grid = pack(top, cols, kids, k);
    if (grid.cols < cols) continue; // the same grid as a narrower try
    for (let pc = parts.length ? 1 : 0; pc <= Math.min(3, parts.length); pc++) {
      const pr = pc ? Math.ceil(parts.length / pc) : 0;
      const W = (pc ? pc * ppx - GX + GUTTER : 0) + grid.cols * px - GX, H = Math.max(pr, grid.rows) * py - GY;
      const s = Math.min(CANVAS[0] / (W + 2 * VIEW_PAD), CANVAS[1] / (H + 2 * VIEW_PAD));
      if (!best || s > best.s + 1e-9) best = { s, grid, pc };
    }
  }
  const { grid, pc } = best!;
  const pr = pc ? Math.ceil(parts.length / pc) : 0, x0 = pc ? pc * ppx - GX + GUTTER : 0;
  const n: BoardLayout["n"] = [];
  // readers and writers fill their block column by column, so the list reads top to bottom
  parts.forEach((id, i) => n.push([id, Math.floor(i / pr) * ppx, (i % pr) * py, pw, h, 0]));
  const cell = new Map(grid.at.map(([id, c, r]) => [id, [x0 + c * px, r * py]]));
  const frames = new Map(grid.frames.map((f) => [f[0], f]));
  for (const id of b.nodes) {
    if (!id.startsWith(COLL)) continue;
    const [x, y] = cell.get(id)!, f = frames.get(id);
    if (!f) { n.push([id, x, y, cw, h, 0]); continue; }
    // a frame's box is all its cells, padded out around them (less when nested in another frame)
    const p = framePad(id.slice(COLL.length));
    n.push([id, x - p, y - p, f[3] * px - GX + 2 * p, f[4] * py - GY + 2 * p, 0]);
  }
  return { n, e: [] };
}
