// The initial view of a board and the pinch math. Fitting a whole board into a phone-width canvas
// shrinks box names below legibility, so the fit stops at a readable zoom and the rest is a pan away.
import { dock } from "./dock.ts";
import { clearCorner, slideCap, type Box4 } from "./corner.ts";
import { zoomClass } from "./focus.ts";
import { atRegion, coveredBottom, openRegion } from "./region.ts";
import { STORY, actorOf, st } from "./state.ts";
import type { BoardLayout } from "../build/layout.ts";
import { onEvery } from "./everydraw.ts";
import { atFit, setOwned, syncReframe } from "./reframe.ts";
import { limitsFor, type Limits } from "./zoomlimits.ts";

/** Box names are 14.5px in board units (board.css); keep them at least this big on screen. */
export const NAME_PX = 14.5;
export const MIN_NAME_PX = 11;

type View = number[];

/**
 * The view to open a board at: the whole board when it fits at a readable zoom; otherwise a window
 * at the minimum readable zoom, with the canvas's aspect, starting at the board's left edge (where every
 * board starts reading) or at `at`, or centered on an axis the board does not fill. Cropped top to bottom, it
 * starts at the top of the boxes in that left window (centered on them when they fit), not on an
 * empty corner (#210: a story's actors sit halfway down a tall board).
 */
export function readableView(whole: View, cw: number, ch: number, minScale = MIN_NAME_PX / NAME_PX, boxes: Box4[] = [], at = whole[0]): View {
  if (!cw || !ch || Math.min(cw / whole[2], ch / whole[3]) >= minScale) return [...whole];
  const w = cw / minScale, h = ch / minScale;
  const x = w < whole[2] ? Math.max(whole[0], Math.min(whole[0] + whole[2] - w, at)) : whole[0] + (whole[2] - w) / 2;
  let y = h < whole[3] ? whole[1] : whole[1] + (whole[3] - h) / 2;
  const col = boxes.filter((b) => b[0] < x + w && b[0] + b[2] > x);
  if (h < whole[3] && col.length) y = Math.max(whole[1], Math.min(whole[1] + whole[3] - h, spanStart(col, 1, h)));
  return [x, y, w, h];
}

/** Board point under a client point, for an svg drawn with preserveAspectRatio "xMidYMid meet". */
export function toBoard(v: View, r: { left: number; top: number; width: number; height: number }, cx: number, cy: number): [number, number] {
  const s = Math.max(v[2] / r.width, v[3] / r.height);
  return [v[0] + (cx - r.left - (r.width - v[2] / s) / 2) * s, v[1] + (cy - r.top - (r.height - v[3] / s) / 2) * s];
}

/**
 * Two-finger gesture: the board point that was under the fingers' first midpoint `c0` stays under
 * their current midpoint `c1`, and the view scales by how far the fingers spread (`d0` → `d1`).
 */
export function pinchView(v0: View, r: { left: number; top: number; width: number; height: number }, c0: [number, number], c1: [number, number], d0: number, d1: number): View {
  const f = d0 / Math.max(d1, 1), p = toBoard(v0, r, ...c0);
  const w = v0[2] * f, h = v0[3] * f, s = Math.max(w / r.width, h / r.height);
  return [p[0] - (c1[0] - r.left - (r.width - w / s) / 2) * s, p[1] - (c1[1] - r.top - (r.height - h / s) / 2) * s, w, h];
}

/**
 * View v, framed for the top `open` px of a cw×ch canvas, as a view of the whole canvas: same zoom,
 * v's center at the open part's center. The rest of the canvas is under the phone's raised sheet.
 */
export const atTop = (v: View, cw: number, ch: number, open: number): View => atRegion(v, cw, ch, { x: 0, y: 0, w: cw, h: open });

/**
 * Where a window `w` long starts on axis k (0 = x, 1 = y) to show rects rs with a 24 margin: centered
 * on them when they fit, as story.ts frames a tapped sentence; otherwise from their start, or from
 * `from` when that is later. The story's opening view (#288) passes its actors' right edge as `from`,
 * so a sentence too wide to show whole shows its part, the arrow in and the arrow's pill, the actor off
 * the left edge.
 */
export const spanStart = (rs: Box4[], k: number, w: number, from = -1 / 0): number => {
  const lo = Math.min(...rs.map((r) => r[k])) - 24, hi = Math.max(...rs.map((r) => r[k] + r[k + 2])) + 24;
  return hi - lo > w ? Math.max(lo, from) : (lo + hi - w) / 2;
};

/** The boxes the story's first sentence lights (story.ts litBy, set as a board is shown; null off the story). */
let lit: Set<string> | null = null;
const rect = ([, x, y, w, h]: BoardLayout["n"][0]): Box4 => [x, y, w, h];
export const setOpening = (r: Set<string> | null) => void (lit = r);

let whole: View = [0, 0, 0, 0];

const size = () => [st.svgEl.clientWidth, st.svgEl.clientHeight] as const;

/**
 * The readable minimum applies to narrow canvases only: on a desktop the whole board fits at a size
 * that is still worth seeing, and cropping it would hide edges for little gain.
 */
const fitFor = (cw: number, ch: number) => {
  // the open part of the canvas: the floating header, the wide-window panel and the phone's sheet are not in it
  const r = openRegion(cw, ch, dock(), coveredBottom(ch)), w = r.w, open = r.h;
  // A narrow canvas opens at the readable zoom, cropped; the rest is a pan away and edgecue.ts marks each clipped side.
  let v = w < 760 && !onEvery() ? readableView(whole, w, open, undefined, boxes()) : [...whole];
  const cropped = v[2] < whole[2] - 0.5 || v[3] < whole[3] - 0.5;
  // a cropped story opens on its first sentence, not on actors with arrows leaving the screen (#288)
  const n = lit ? st.data.layout[STORY].n.filter((r) => lit!.has(r[0])) : [], rs = n.map(rect);
  const at = cropped && n.length;
  if (at) v = readableView(whole, w, open, undefined, rs, spanStart(rs, 0, v[2], Math.max(...n.filter((r) => actorOf(r[0])).map((r) => r[1] + r[3])) - 24));
  // off the region's left edge counts as covered too, so a slide never pushes the first column out of view.
  // The story's opening clears only the sentence's boxes it shows whole: the actor it leaves off the left
  // edge, or a part cut by the right one, would push the sentence under the sheet
  const btn = (sel: string): Box4 => { const b = buttons(sel); return b[2] ? [b[0] - r.x, b[1] - r.y, b[2], b[3]] : b; };
  const c = clearCorner(v, at ? rs.filter((r) => r[0] >= v[0] && r[0] + r[2] <= v[0] + v[2]) : boxes(), w, open, [btn(".zoom"), btn(".canvas > .hist"), btn(".dial"), [-w, 0, w, open]], cropped, slideFor(v, w, open));
  return r.w < cw || r.h < ch || r.y ? atRegion(c, cw, ch, r) : c;
};

/** How far cropped view v may slide sideways to clear the dial (corner.ts slideCap); no dial, no slide. */
export const slideFor = (v: View, cw: number, ch: number): number => slideCap(v, whole, buttons(".dial")[2], cw, ch);

/** The board's fit for the canvas as it is now (the board's own extent, no walk framing). */
export const boardFit = (): View => fitFor(...size());

const boxes = (): Box4[] => {
  const l = st.data.layout[st.cur], out = (l?.n ?? []).map(rect);
  // a board of containers routes arrows along the gutters, around its outside too: keep them clear of the buttons
  if (l && onEvery()) for (const [, , , ...p] of l.e) for (let i = 2; i + 1 < p.length; i += 2) out.push([Math.min(p[i - 2], p[i]), Math.min(p[i - 1], p[i + 1]), Math.max(2, Math.abs(p[i] - p[i - 2])), Math.max(2, Math.abs(p[i + 1] - p[i - 1]))]);
  return out;
};

/** A corner's buttons (zoom, or Back/Forward) as a rect on the canvas, with a margin. */
export function buttons(sel: string): Box4 {
  // the canvas, not the svg filling it: a board change's zoom may be scaling the svg still
  const z = document.querySelector(sel)?.getBoundingClientRect(), s = document.getElementById("canvas")!.getBoundingClientRect();
  return z && z.width ? [z.left - s.left - 8, z.top - s.top - 6, z.width + 16, z.height + 12] : [0, 0, 0, 0];
}

/** Sets the fitted view (`st.base`) for the board just drawn and shows it. */
export function fitBoard(): void {
  whole = st.svgEl.getAttribute("viewBox")!.split(" ").map(Number);
  refit();
}

function refit(): void {
  // hidden first, so the fit measures the strip the same way whether or not Reframe was showing
  const z = document.getElementById("zfit");
  if (z) z.hidden = true;
  st.base = fitFor(...size());
  st.view = [...st.base];
  st.svgEl.setAttribute("viewBox", st.view.join(" "));
  syncReframe();
}

/** Refits only a view still at the fit: a reader who panned or zoomed is never moved. */
export function refitIfAtFit(): void { if (atFit()) refit(); }

/** The current board's zoom and pan bounds on the canvas as it is now (zoomlimits.ts). */
export function limits(): Limits {
  return limitsFor(whole, st.base, ...size());
}

/** The Reframe button: back to the readable fit. */
export const reframe = (): View => [...st.base];

/** Set while something else frames the board (the walkthrough, above its strip): it gets the new plain fit and refits its own way. */
let refitter: ((fit: View) => void) | null = null;
export function setRefitter(f: ((fit: View) => void) | null): void {
  refitter = f;
  setOwned(f !== null);
  syncReframe();
}

/** A rotation, a resized pane or the header settling (web fonts) refits the board, unless the reader has moved it. */
export function installFit(): void {
  let was = "";
  const again = (moved = false) => {
    const now = size().join();
    if (!st.svgEl || (now === was && !moved)) return;
    was = now;
    if (refitter) return refitter(fitFor(...size()));
    if (!atFit()) return;
    refit();
    zoomClass();
  };
  new ResizeObserver(() => again()).observe(document.getElementById("canvas")!);
  // the floating header or panel changed size (dock.ts) without the canvas doing so
  window.addEventListener("dockchange", () => again(true));
}
