// Focus zoom, on every board: selecting a box or an arrow (a click or a tap, never a hover) fades the
// rest, as focus.ts already does, and glides the view to fit the selection, its neighbors and their
// arrows, so they come up bigger. The view stays the reader's while something is selected: pan, wheel,
// pinch and the zoom buttons work as usual, and nothing pulls it back. Clearing the selection
// (deselect.ts: Esc, a click on empty canvas, or a second click on the selected box) glides back out
// to the board's fit: "it zooms back out to the whole board". On a
// phone the fit leaves room for the bottom sheet.
// The owner picked it on every board asked: "zoom to fit, but free to nav and zoom on my own" (round 2).
// localStorage "repoladder.zoom" = "off" turns it off (screenshots of "stays put" use it).
import { topEdge } from "./embed.ts";
import { settled, shuffleOn } from "./transition.ts";
import type { Box4 } from "./corner.ts";
import { clearOfButtons, cornerButtons } from "./focuscorner.ts";
import { boundsOf as union } from "./everyfit.ts";
import { litBy } from "./focus.ts";
import { limits, MIN_NAME_PX, NAME_PX } from "./fit.ts";
import { setView } from "./panzoom.ts";
import { sameView } from "./reframe.ts";
import { reduced } from "./pulse.ts";
import { heights, narrow } from "./sheet.ts";
import { $, STORY, st } from "./state.ts";

export interface Box { x: number; y: number; w: number; h: number }
type View = number[];

export const ZOOM_KEY = "repoladder.zoom";
/** Box names never zoom past this many pixels: bigger stops helping and loses the context. */
const MAX_NAME_PX = 24;
const MS = 420;

/**
 * The view that fits `b` (board units) centered in `area` (svg pixels, the part of the canvas not
 * under the sheet) of an svg `w`×`h`, no closer than `kMax` pixels per unit. The view has the svg's
 * aspect, so "meet" adds no letterbox and the math is exact. Exported for tests.
 */
export function focusView(b: Box, w: number, h: number, area: Box, kMax: number, m = 28): View {
  const k = Math.min((area.w - 2 * m) / Math.max(b.w, 1), (area.h - 2 * m) / Math.max(b.h, 1), kMax);
  const ax = area.x + area.w / 2, ay = area.y + area.h / 2;
  return [b.x + b.w / 2 - ax / k, b.y + b.h / 2 - ay / k, w / k, h / k];
}

/** Union of boxes (everyfit.ts's). Exported for tests. */
export { union };

/** Whether two views are the same, to the half unit (reframe.ts). Exported for tests. */
export { sameView };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const off = () => { try { return localStorage.getItem(ZOOM_KEY) === "off"; } catch { return false; } };

let frame = 0;
let forSvg: SVGSVGElement | null = null;
let lastSel: string | null = null;

/** Glides the view to `to` (everyview.ts uses it too). */
export function glide(to: View): void {
  cancelAnimationFrame(frame);
  const from = [...st.view], svg = st.svgEl, t0 = performance.now();
  if (reduced()) return setView(to);
  const step = (now: number) => {
    if (st.svgEl !== svg) return;
    const t = Math.min(1, (now - t0) / MS), e = ease(t);
    setView(from.map((v, i) => v + (to[i] - v) * e));
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/** The view that frames the current selection and what it lights, or null when nothing is drawn. */
function target(): View | null {
  const svg = st.svgEl, gs = [...svg.querySelectorAll<SVGGElement>("g[data-hit]")];
  const on = litBy(st.selected!, gs.map((g) => g.dataset.hit!));
  const bs = gs.filter((g) => on.has(g.dataset.hit!) && !g.classList.contains("f-off")).map((g) => g.getBBox()).filter((b) => b.width || b.height).map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }));
  if (!bs.length) return null;
  // the layout size, not the drawn rect: a board change's zoom (transition.ts) may be scaling the svg still (#210)
  const r = { width: svg.clientWidth, height: svg.clientHeight, bottom: $("canvas").getBoundingClientRect().bottom };
  // on a phone the sheet rises to half when something is selected (sheet.ts): fit above it
  const hidden = narrow() ? Math.max(0, r.bottom - (innerHeight - heights(innerHeight, topEdge()).half)) : 0;
  const kBase = Math.min(r.width / st.base[2], r.height / st.base[3]), u = union(bs);
  const fit = (a: Box) => focusView(u, r.width, r.height, a, Math.max(kBase, MAX_NAME_PX / NAME_PX));
  const area = { x: 0, y: 0, w: r.width, h: Math.max(r.height - hidden, r.height * 0.35) };
  // on a phone the corner buttons leave no free room at the top: frame the selection below them (#152)
  if (!narrow()) return fit(area);
  // a hair over the floor, so panzoom.ts's clamp leaves the view as framed
  // and never so far out that names can't be read: the selected box wins over its neighbors (#210)
  const kMin = Math.max(limits().kMin * 1.001, MIN_NAME_PX / NAME_PX), s = gs.find((g) => g.dataset.hit === st.selected)?.getBBox();
  const sel: Box4 | null = s ? [s.x, s.y, s.width, s.height] : null;
  return clearOfButtons({ fit, area, union: u, boxes: bs.map((b) => [b.x, b.y, b.w, b.h]), sel, w: r.width, h: r.height, btns: cornerButtons(), kMin });
}

/** Called after every selection change (navigate.ts select()). */
export function focusZoom(): void {
  if (!st.svgEl) return;
  // a shuffle glides boxes in the new board's own view: frame the selection once it ends
  if (shuffleOn()) { void settled().then(focusZoom); return; }
  if (forSvg !== st.svgEl) { forSvg = st.svgEl; lastSel = null; cancelAnimationFrame(frame); }
  // the story level has its own sentence zoom (story.ts); a tour never selects (tour.ts frames its steps)
  if (off() || st.selected === lastSel) return;
  lastSel = st.selected;
  const step = zoomStep(st.selected, st.svgEl.classList.contains("fz"), st.cur === STORY);
  const to = step === "focus" ? target() : step === "fit" ? [...st.base] : null;
  st.svgEl.classList.toggle("fz", step === "focus" && !!to);
  if (to) glide(to);
}

/**
 * What a selection change does to the view: a selection zooms to it; clearing one that zoomed glides
 * back out to the board's fit (#148). The story level frames its own sentences. Exported for tests.
 */
export function zoomStep(selected: string | null, zoomed: boolean, story: boolean): "focus" | "fit" | null {
  if (selected) return story ? null : "focus";
  return zoomed ? "fit" : null;
}

/** Back/Forward restored the selection and its view as they were: take them as already focused. */
export function focusSettled(): void {
  forSvg = st.svgEl; lastSel = st.selected; cancelAnimationFrame(frame);
  st.svgEl.classList.toggle("fz", !off() && !!st.selected && !sameView(st.view, st.base));
}

export function installFocusZoom(): void {
  const canvas = $("canvas");
  // the reader's own pan or zoom stops a glide still under way, so the view never fights them
  const stop = () => cancelAnimationFrame(frame);
  canvas.addEventListener("wheel", stop, { passive: true });
  canvas.addEventListener("pointerdown", stop);
}
