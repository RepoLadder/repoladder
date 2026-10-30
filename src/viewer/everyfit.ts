// Fitting a board of containers to the window (#183). ELK's rectpacking packs row by row toward one
// aspect ratio, which can leave holes and a board the wrong shape for the screen. So once ELK has laid
// out the leaf containers (layered; no packing changes them), every container of containers is
// packed again here (skyline.ts), a few ways, and the board keeps the packing whose boxes cover the
// most canvas at the fit among those that keep the board's reading order, unless that gives up more
// than ORDER_SLACK of the coverage (#463). So a window of another shape moves where rows wrap, not
// which box is first. The arrangement is chosen when a board is laid out; a resize only re-zooms. The lane ("elsewhere" boxes and services) sits at the board's right edge,
// or its bottom on a clearly tall canvas (laneSide), never in the packing. Pure.
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { Rect } from "./gutters.ts";
import { packings } from "./skyline.ts";

/** The desktop canvas's shape (1280×800), for callers that don't know the window. */
export const CANVAS_ASPECT = 1.6;
/** The canvas's shape, rounded to steps of about 28%, so a small resize reuses the layouts already made. */
export const aspectBucket = (w: number, h: number): number => (w > 0 && h > 0 ? Math.round(Math.exp(Math.round(Math.log(w / h) * 4) / 4) * 100) / 100 : CANVAS_ASPECT);

/**
 * The share of coverage a board may give up to keep its boxes in reading order (#463); beyond it the
 * best packing in any order wins. Set from test/orderkept.test.ts's table (ORDER_TUNE=1, 24 seeded
 * boards, 4 window shapes; mean stability / mean coverage loss / worst loss): 0 .413 / 0% / 0%;
 * 0.05 .408 / 0% / 4%; 0.1 .424 / 0.2% / 9%; 0.15 .446 / 1.8% / 14%; 0.2 .493 / 3.9% / 18%. 0.1
 * stays: loss is under 5% and stability beats 0.
 */
export const ORDER_SLACK = 0.1;

export type LaneSide = "right" | "bottom";
/**
 * The canvas shape below which the lane moves to the bottom (#246). Moving it re-packs the whole
 * board, so only a clearly tall canvas does: a phone's (390×844 leaves a 0.63 canvas) but not a
 * near-square window's (900×1000 beside the panel leaves 0.69).
 */
export const LANE_TALL = 0.66;
/** How far past LANE_TALL, as a ratio, the canvas must move before a placed lane changes side. */
export const LANE_MARGIN = 1.1;

/**
 * Where the lane goes on a canvas of shape `aspect` (width over height, unbucketed): the bottom when
 * it is clearly tall, else the right. Given the side it is on now (`prev`), it stays there until the
 * canvas moves LANE_MARGIN past LANE_TALL, so a window resized near the line doesn't flip it back and forth.
 */
export function laneSide(aspect: number, prev?: LaneSide): LaneSide {
  const at = prev === "bottom" ? LANE_TALL * LANE_MARGIN : prev === "right" ? LANE_TALL / LANE_MARGIN : LANE_TALL;
  return aspect < at ? "bottom" : "right";
}

/**
 * The lane's boxes beside `parts` (their bounding box): in a column at its right, or a row below it
 * (`side`), centered on it, `gap` apart and `2 × gap` from the parts; a lane longer than the parts
 * wraps into another column (row).
 */
export function laneRects(boxes: [string, number, number][], parts: Rect, side: LaneSide, gap: number): Map<string, Rect> {
  const right = side === "right", at = new Map<string, Rect>();
  // in the lane's frame: [id, along the edge, across it, w, h]
  const lines: [string, number, number, number, number][][] = [[]];
  let used = 0;
  for (const [id, w, h] of boxes) {
    const len = right ? h : w;
    if (used && used + gap + len > (right ? parts.h : parts.w)) { lines.push([]); used = 0; }
    used += (used ? gap : 0) + len;
    lines[lines.length - 1].push([id, len, right ? w : h, w, h]);
  }
  let across = (right ? parts.x + parts.w : parts.y + parts.h) + 2 * gap;
  for (const line of lines) {
    const thick = Math.max(0, ...line.map((b) => b[2]));
    let along = (right ? parts.y + parts.h / 2 : parts.x + parts.w / 2) - line.reduce((s, b) => s + b[1] + gap, -gap) / 2;
    for (const [id, len, t, w, h] of line) {
      const off = across + (thick - t) / 2;
      at.set(id, right ? { x: off, y: along, w, h } : { x: along, y: off, w, h });
      along += len + gap;
    }
    across += thick + gap;
  }
  return at;
}

export const boundsOf = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((q) => q.x)), y = Math.min(...rs.map((q) => q.y));
  return { x, y, w: Math.max(...rs.map((q) => q.x + q.w)) - x, h: Math.max(...rs.map((q) => q.y + q.h)) - y };
};

/** A container whose children are all closed: laid out layered, so it is one fixed block to the packing. */
const isBlock = (n: ElkNode) => !n.children?.length || n.children.every((c) => !c.children?.length);

/**
 * The share of a canvas of shape `aspect` that a laid-out board's blocks (leaf containers, closed
 * boxes) and lane (at `side`) cover at the fit: their area over the bounding box, times the share of
 * the canvas that box covers.
 */
export function fitScore(r: ElkNode, lane: [string, number, number][], aspect: number, gap: number, side = laneSide(aspect)): number {
  const tops: Rect[] = [], blocks: Rect[] = [];
  const walk = (n: ElkNode, ox: number, oy: number, depth: number) => {
    const x = ox + (n.x ?? 0), y = oy + (n.y ?? 0), q = { x, y, w: n.width!, h: n.height! };
    if (depth === 1) tops.push(q);
    if (depth && isBlock(n)) blocks.push(q);
    else for (const c of n.children ?? []) walk(c, x, y, depth + 1);
  };
  walk({ ...r, x: 0, y: 0 }, 0, 0, 0);
  if (!tops.length) return 0;
  const ls = [...laneRects(lane, boundsOf(tops), side, gap).values()];
  const box = boundsOf([...tops, ...ls]), a = box.w / box.h;
  return [...blocks, ...ls].reduce((s, q) => s + q.w * q.h, 0) / (box.w * box.h) * Math.min(a / aspect, aspect / a);
}

const nums = (s: string | undefined) => (s?.match(/[\d.]+/g) ?? []).map(Number);

/**
 * Laid-out board `r` packed again to fill a canvas of shape `aspect`, with its score. Bottom up, each
 * container of containers takes the packing of what it holds with the least room left over, leaning
 * by `lean` toward an inner aspect ratio; the board takes the packing that scores best (fitScore).
 * Done twice, over a few inner ratios and leans: once preferring packings that keep the children's
 * order (a container takes the best of them while it is within `slack` of its best packing), once in
 * any order, `r` among them. The ordered board wins while it scores within `slack` of the other, so
 * the board never gives up more than `slack` of the coverage (a negative `slack` never prefers
 * order). `opts` are the graph's own layout options by id (padding, spacing, least size; a layout's
 * result may drop them); `side`, the lane's.
 */
export function repack(r: ElkNode, opts: Map<string, ElkNode["layoutOptions"]>, aspect: number, lane: [string, number, number][], gap: number, side = laneSide(aspect), slack = ORDER_SLACK): [ElkNode, number] {
  let best: [ElkNode, number] = [r, fitScore(r, lane, aspect, gap, side)], ord: [ElkNode, number] = [r, -1];
  const pack = (n: ElkNode, t: number, lean: number, keep: boolean): ElkNode => {
    if (n !== r && isBlock(n)) return n;
    const kids = n.children!.map((c) => pack(c, t, lean, keep)), o = opts.get(n.id) ?? {}, want = n === r ? aspect : t;
    const [pt, pl, pb, pr] = nums(o["elk.padding"]), [mw = 0, mh = 0] = nums(o["elk.nodeSize.minimum"]);
    let got = n, top = -1, kept = n, topKept = -1;
    for (const p of packings(kids.map((k) => [k.width!, k.height!]), want, Number(o["elk.spacing.nodeNode"] ?? 0))) {
      const children = kids.map((k) => ({ ...k }));
      p.order.forEach((k, i) => Object.assign(children[k], { x: pl + p.at[i][0], y: pt + p.at[i][1] }));
      const w = Math.max(mw, pl + p.w + pr), h = Math.max(mh, pt + p.h + pb), node = { ...n, children, width: w, height: h };
      const s = n === r ? fitScore(node, lane, aspect, gap, side) : kids.reduce((s, k) => s + k.width! * k.height!, 0) / (p.w * p.h) * Math.min(w / h / want, want * h / w) ** lean;
      if (s > top + 1e-6) [got, top] = [node, s];
      if (p.ordered && s > topKept + 1e-6) [kept, topKept] = [node, s];
    }
    return keep && topKept >= top * (1 - slack) ? kept : got;
  };
  if (!isBlock(r)) for (const t of [1.5, 1, 2.2]) for (const lean of [0.25, 0.5, 1]) for (const keep of [false, true]) {
    if (keep && slack < 0) continue;
    const c = pack(r, t, lean, keep), s = fitScore(c, lane, aspect, gap, side), to = keep ? ord : best;
    if (s > to[1] + 1e-6) (keep ? ord = [c, s] : best = [c, s]);
  }
  return ord[1] >= best[1] * (1 - slack) ? ord : best;
}
