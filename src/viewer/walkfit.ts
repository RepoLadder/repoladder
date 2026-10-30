// The walkthrough's caption is a strip below the canvas (walk.ts, #164): the board keeps its fit, and
// each step pans, if it must, so the step's lit boxes and arrow are in view. On a phone the strip sits
// at the bottom of the canvas, so the board makes room for it: on entering, a board shown at its fit is refitted into the part of the canvas above the strip,
// and each step pans, if it must, so the step's lit boxes and arrow sit above the strip. Leaving puts
// the plain fit back, unless the reader has moved the view in between. A resize or rotation mid-walk refits
// above the strip too (fit.ts hands its refit over), so leaving later returns to the fit for the new size.
// The owner picked the caption on the canvas, under the board.
import { clearCorner, covers, type Box4 } from "./corner.ts";
import { MIN_NAME_PX, NAME_PX, boardFit, setRefitter, slideFor } from "./fit.ts";
import { cornerButtons as clearOf } from "./focuscorner.ts";
import { zoomClass } from "./focus.ts";
import { reduced } from "./pulse.ts";
import { st } from "./state.ts";
import { scaleOf } from "./zoomlimits.ts";

type View = number[];
/** Exported for tests. */
export { covers };
export interface Rect { x: number; y: number; w: number; h: number }

const M = 16;
const same = (a: View, b: View) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5);

/**
 * The view that shows all of `v` in the band of a cw×ch canvas from `y0` down to `top` pixels (centered
 * there), never zoomed in past `v`'s own scale. The result has the canvas's aspect, so "meet" adds no
 * letterbox. Exported for tests.
 */
export function aboveStrip(v: View, cw: number, ch: number, top: number, y0 = 0): View {
  const k = Math.min(scaleOf(v, cw, ch), cw / v[2], Math.max(top - y0, 1) / v[3]);
  return [v[0] + v[2] / 2 - cw / 2 / k, v[1] + v[3] / 2 - (y0 + top) / 2 / k, cw / k, ch / k];
}

/**
 * On a phone: view p (panned to the step) moved down, then slid sideways (≤ maxX), until no lit box is
 * under a corner button, the strip (from `top`) or off the left edge; p when nothing clears. Exported for tests.
 */
export function clearLit(p: View, lit: Box4[], cw: number, ch: number, top: number, btns: Box4[], maxX: number): View {
  return clearCorner(p, lit, cw, ch, [...btns, [0, top, cw, ch - top], [-cw, 0, cw, ch]], true, maxX);
}

/**
 * For a narrow canvas, whose fit stops at a readable zoom (fit.ts): view `v` zoomed out only as far as
 * needed for board rect `r` to fit the band from `y0` to `top` (with a margin), never past `minK` nor
 * zoomed in, with the canvas's aspect. r is centered in the band if it fits, else its top is at the band's
 * top (where reading starts); across, it is centered if it fits, else v's left edge stays. Exported for tests.
 */
export function liftAbove(v: View, cw: number, ch: number, top: number, r: Rect, y0 = 0, minK = MIN_NAME_PX / NAME_PX): View {
  const k0 = scaleOf(v, cw, ch), band = top - y0 - 2 * M;
  const k = Math.max(Math.min(k0, band / r.h), Math.min(k0, minK));
  const x = r.w * k <= cw ? r.x + r.w / 2 - cw / 2 / k : v[0] - (cw - v[2] * k0) / 2 / k0;
  const y = r.h * k <= band ? r.y + r.h / 2 - (y0 + top) / 2 / k : r.y - (y0 + M) / k;
  return [x, y, cw / k, ch / k];
}

/**
 * The board's fit redone above the strip, cleared of the corner buttons as an opening view is (corner.ts),
 * else below them if the plain one puts a box under them. A narrow canvas zooms out no further than its
 * readable fit allows (liftAbove).
 */
function walkFit(base: View, cw: number, ch: number, top: number): View {
  const btns = clearOf(), phone = cw < 760;
  const boxes = (st.data.layout[st.cur]?.n ?? []).map(([, x, y, w, h]): Box4 => [x, y, w, h]);
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
  const r = { x: x0, y: y0, w: Math.max(...boxes.map((b) => b[0] + b[2])) - x0, h: Math.max(...boxes.map((b) => b[1] + b[3])) - y0 };
  const fitIn = (y: number) => (!phone ? aboveStrip(base, cw, ch, top, y) : boxes.length ? liftAbove(base, cw, ch, top, r, y) : base);
  // clearCorner gives back v itself when v is clear already or nothing clears it
  const v = fitIn(0), c = clearCorner(v, boxes, cw, ch, btns, phone, slideFor(v, cw, ch));
  return c != v || !covers(v, cw, ch, boxes, btns) ? c : fitIn(Math.max(...btns.map((b) => b[1] + b[3])));
}

/**
 * View `v` (canvas aspect) panned the least that puts board rect `r` inside the top `top` pixels of a
 * cw×ch canvas, with a margin; a rect too big for that is centered there. Exported for tests.
 */
export function panAbove(v: View, cw: number, ch: number, top: number, r: Rect): View {
  const k = scaleOf(v, cw, ch), ox = (cw - v[2] * k) / 2, oy = (ch - v[3] * k) / 2;
  const sx = ox + (r.x - v[0]) * k, sy = oy + (r.y - v[1]) * k, sw = r.w * k, sh = r.h * k;
  const shift = (s: number, len: number, lo: number, hi: number) =>
    len > hi - lo - 2 * M ? s + len / 2 - (lo + hi) / 2 : s < lo + M ? s - lo - M : s + len > hi - M ? s + len - hi + M : 0;
  const dx = shift(sx, sw, 0, cw), dy = shift(sy, sh, 0, top);
  return dx || dy ? [v[0] + dx / k, v[1] + dy / k, v[2], v[3]] : v;
}

/** The walk's framing redone for a resized canvas: the board's fit (`base`) and the view (null: leave it). */
export interface Refit { base: View; view: View | null }

/**
 * After a resize mid-walk, `plain` is the board's new fit for the cw×ch canvas: the walk's fit above
 * the strip (`above`) takes its place, as on entering. The view moves only if it is still the walk's
 * (`ours`), panned to the step's lit rect. Exported for tests.
 */
export function walkResized(plain: View, cw: number, ch: number, top: number, lit: Rect | null, ours: boolean, above = (b: View) => aboveStrip(b, cw, ch, top)): Refit {
  const base = above(plain);
  const view = !ours ? null : lit ? panAbove(base, cw, ch, top, lit) : base;
  return { base, view };
}

/** The step's lit boxes (board units), each on its own: their union would reach under a corner no box is under. */
const litBoxes = (): Box4[] => [...st.svgEl.querySelectorAll<SVGGElement>("g[data-hit^='n:'].wk-now")].map((g) => g.getBBox()).map((b) => [b.x, b.y, b.width, b.height]);

/** Whether the strip is on the canvas (a phone), so the board's fit makes room for it. */
const onCanvas = () => !!document.querySelector("#canvas > .walk-card");

/** The strip's top, in canvas pixels (the canvas's height when the strip is below it), or null when no strip is shown. */
function stripTop(): number | null {
  const s = document.querySelector<HTMLElement>(".walk-card");
  if (!s || !st.svgEl) return null;
  const c = st.svgEl.getBoundingClientRect(), r = s.getBoundingClientRect();
  return onCanvas() ? r.top - c.top - 8 : c.height;
}

/** The view the walk last set, so leaving can tell whether the reader moved it since. */
let walkView: View | null = null;

let frame = 0, gliding = false;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function put(v: View): void {
  st.view = v;
  st.svgEl.setAttribute("viewBox", v.join(" "));
  zoomClass();
}
/** Stops a glide still under way, so the view never fights the reader's own pan or zoom. */
export function stopWalkGlide(): void {
  cancelAnimationFrame(frame);
  if (gliding) walkView = null;
  gliding = false;
}
function show(to: View): void {
  cancelAnimationFrame(frame);
  const from = [...st.view], svg = st.svgEl, t0 = performance.now();
  if (reduced()) return put(to);
  gliding = true;
  const step = (now: number) => {
    if (st.svgEl !== svg) return void (gliding = false);
    const t = Math.min(1, (now - t0) / 380), e = ease(t);
    put(from.map((x, i) => x + (to[i] - x) * e));
    if (t < 1) frame = requestAnimationFrame(step);
    else gliding = false;
  };
  frame = requestAnimationFrame(step);
}

/** The current step's rect, so a resize can pan to it again. */
let lastLit: Rect | null = null;

/** A resize mid-walk (fit.ts hands over the new plain fit): refit above the strip, not to the full canvas. */
function resized(plain: View): void {
  const top = stripTop(), cw = st.svgEl.clientWidth, ch = st.svgEl.clientHeight;
  const ours = gliding || (!!walkView && same(st.view, walkView)) || same(st.view, st.base);
  cancelAnimationFrame(frame);
  gliding = false;
  if (top === null) {
    st.base = plain;
    if (ours) put([...plain]);
    return;
  }
  const r = walkResized(plain, cw, ch, top, lastLit, ours, onCanvas() ? (b) => walkFit(b, cw, ch, top) : (b) => b);
  st.base = r.base;
  if (r.view) put(r.view);
  walkView = r.view ?? walkView;
}

/**
 * Called after each step is drawn: `entering` on the walk's first step; `lit` is the step's rect.
 * The fit above the strip becomes the board's fit (`st.base`) for the walk, so the fit button and the
 * zoom floor (zoomlimits.ts) go by it.
 */
export function walkFrame(entering: boolean, lit: Rect | null): void {
  const top = stripTop();
  if (top === null) return;
  lastLit = lit;
  setRefitter(resized);
  const cw = st.svgEl.clientWidth, ch = st.svgEl.clientHeight;
  let v = st.view;
  // a phone opens a big board cropped at a readable zoom: walkFit keeps that zoom and only moves it up
  if (entering && same(v, st.base) && onCanvas()) {
    v = st.base = walkFit(st.base, cw, ch, top);
  }
  // and a lit box clear of the corner buttons and the dial (on a phone, above its strip too)
  if (lit) {
    const p = panAbove(v, cw, ch, top, lit);
    v = onCanvas() ? clearLit(p, litBoxes(), cw, ch, top, clearOf(), slideFor(p, cw, ch)) : clearCorner(p, litBoxes(), cw, ch, clearOf());
  }
  if (!same(v, st.view)) show(v);
  walkView = [...v];
}

/** Called on leaving: back to the board's plain fit now (a step's box may have grown it since entering, #290) if the view is still the walk's (`restore`: not when another board opened). */
export function walkUnframe(restore = true): void {
  const ours = restore && !!walkView && (gliding || same(st.view, walkView) || same(st.view, st.base));
  cancelAnimationFrame(frame);
  gliding = false;
  if (restore && st.svgEl) st.base = boardFit();
  if (ours && st.svgEl) show([...st.base]);
  walkView = lastLit = null;
  setRefitter(null);
}
