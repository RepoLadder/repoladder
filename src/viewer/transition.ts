// Semantic zoom between boards. Opening a part zooms the old board into that part's box while the
// new board grows out of it; going up runs it backwards; anything else crossfades. The new board is
// live at once (show() stays synchronous, so tours and select() work unchanged): the old one lingers
// as an inert "ghost" overlay for the length of the animation. Context boxes on the new board glide
// in from where the same parts sat on the old one (and back out when leaving).
// Transforms and opacity only, through the Web Animations API, so nothing re-lays out.
import { reduced } from "./pulse.ts";
import { N, home, st } from "./state.ts";

export type Move = { kind: "in" | "out"; via: string } | { kind: "fade" } | { kind: "shuffle" };
export interface Rect { x: number; y: number; w: number; h: number }

/** The zoom and crossfade in ms; travel.ts sets them around its own moves (and scripts can tune them). */
export const pace = { zoom: 400, fade: 220 };
const EASE = "cubic-bezier(.45,0,.2,1)";
/** Past these the per-element animation is not worth it and a shuffle falls back to the crossfade. */
const SHUFFLE_MAX = 60, GROUP_MAX = 240;

/** Ids on both lists, in `b`'s order, once each. */
export const sharedIds = (a: string[], b: string[]): string[] => {
  const has = new Set(a);
  return [...new Set(b)].filter((id) => has.has(id));
};

/** In: `to` is below `from`, and `via` is the box on `from` that leads there. Out: the reverse, `via` sits on `to`. */
export function plan(from: string, to: string, parent: (id: string) => string | null | undefined, shared = 0): Move {
  const side: Move = shared > 0 ? { kind: "shuffle" } : { kind: "fade" };
  if (from === to) return side;
  const under = (top: string, id: string): string | null => {
    for (let c: string | null | undefined = id; c; c = parent(c)) if (parent(c) === top) return c;
    return null;
  };
  const down = under(from, to);
  if (down) return { kind: "in", via: down };
  const up = under(to, from);
  return up ? { kind: "out", via: up } : side;
}

/** Scale and offset that fit rect `a` inside rect `b`, centered (transform-origin 0 0). */
export function fit(a: Rect, b: Rect): { s: number; x: number; y: number } {
  const s = Math.min(b.w / a.w, b.h / a.h);
  return { s, x: b.x + b.w / 2 - s * (a.x + a.w / 2), y: b.y + b.h / 2 - s * (a.y + a.h / 2) };
}

export const css = (t: { s: number; x: number; y: number }) => `translate(${t.x}px,${t.y}px) scale(${t.s})`;

/** Where the viewBox lands inside an SVG of size w×h with preserveAspectRatio "xMidYMid meet". */
export function contentRect(view: number[], w: number, h: number): Rect & { k: number } {
  const k = Math.min(w / view[2], h / view[3]);
  return { x: (w - view[2] * k) / 2, y: (h - view[3] * k) / 2, w: view[2] * k, h: view[3] * k, k };
}

let ghost: Element | null = null, shuffling = false;
/** A shuffle is running: the new board's viewBox must hold still (glide keyframes are in its user units). */
export const shuffleOn = () => shuffling;
let running: Animation[] = [];
let done: Promise<unknown> = Promise.resolve();

/** Resolves once the current transition ends: boxes measured mid-zoom are scaled and moved. */
export const settled = () => done;

/** Jumps any running transition to its end state (rapid clicks, screenshots). */
export function finishTransition(): void {
  running.forEach((a) => a.cancel());
  running = [];
  shuffling = false;
  ghost?.remove();
  ghost = null;
}


function rel(el: Element, svg: SVGSVGElement): Rect {
  const r = el.getBoundingClientRect(), o = svg.getBoundingClientRect();
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
}

const boxOf = (svg: SVGSVGElement, id: string) => [...svg.querySelectorAll<SVGGElement>("g[data-hit^='n:']")].find((g) => g.dataset.hit === `n:${id}`);

// fill forwards: the ghost must not flash back at full opacity between its last frame and cleanup
function play(el: Element, frames: Keyframe[], ms = pace.zoom): void {
  running.push(el.animate(frames, { duration: ms, easing: EASE, fill: "forwards" }));
}

/**
 * Moves the context boxes of `svg` between their own spot and the spot of the same part on `other`.
 * `t` is the svg's own transform at the far end of the move, `view` its viewBox, `enter` the direction.
 */
function glide(svg: SVGSVGElement, other: SVGSVGElement, ids: string[], t: { s: number; x: number; y: number }, view: number[], enter: boolean): void {
  const o = svg.getBoundingClientRect(), c = contentRect(view, o.width, o.height);
  const user = (r: Rect): Rect => ({ x: view[0] + (r.x - c.x) / c.k, y: view[1] + (r.y - c.y) / c.k, w: r.w / c.k, h: r.h / c.k });
  for (const id of ids) {
    const g = boxOf(svg, id), there = boxOf(other, id);
    if (!g || !there) continue;
    const a = rel(there, other);
    // undo the svg's own transform so the box shows exactly where it was on the other board
    const target = user({ x: (a.x - t.x) / t.s, y: (a.y - t.y) / t.s, w: a.w / t.s, h: a.h / t.s });
    const home = user(rel(g, svg));
    const m = target.w / home.w;
    const far = `translate(${target.x - m * home.x}px,${target.y - m * home.y}px) scale(${m})`;
    play(g, enter ? [{ transform: far }, { transform: "none" }] : [{ transform: "none" }, { transform: far }]);
  }
}

let aim: (() => void) | null = null;
/** travel.ts: `f` runs once, on the next zoom, with the new board drawn and before the move is measured (it frames the move's ends). */
export const aimNext = (f: () => void) => void (aim = f);

/** Animates from `old` (board `from`, about to leave) to `next` (board `to`, already in place). */
export function zoomBetween(old: SVGSVGElement | null, from: string, next: SVGSVGElement, to: string): void {
  finishTransition();
  aim?.();
  aim = null;
  if (!old) return;
  if (old === next || typeof old.animate !== "function") { old.remove(); return; }
  old.classList.remove("board");
  old.classList.add("ghost");
  old.setAttribute("aria-hidden", "true");
  old.setAttribute("inert", "");
  next.after(old);
  ghost = old;

  const box = next.getBoundingClientRect();
  const full: Rect = { x: 0, y: 0, w: box.width, h: box.height };
  const hits = (svg: SVGSVGElement) => [...svg.querySelectorAll<SVGGElement>("g[data-hit]")];
  const nodes = (svg: SVGSVGElement) => hits(svg).filter((g) => g.dataset.hit!.startsWith("n:")).map((g) => g.dataset.hit!.slice(2));
  // read from the drawn boards: after a dial-stop change the layout for `from` is already replaced
  let ids = sharedIds(nodes(old), nodes(next));
  if (ids.length > SHUFFLE_MAX || hits(old).length > GROUP_MAX || hits(next).length > GROUP_MAX
    || ids.some((id) => { const a = boxOf(old, id), b = boxOf(next, id); return !a || !b || !rel(a, old).w || !rel(b, next).w; })) ids = [];
  const side: Move = ids.length ? { kind: "shuffle" } : { kind: "fade" };
  let move: Move = reduced() ? { kind: "fade" } : plan(from, to, (id) => {
    // a store board opens from whichever board drew the store
    if (st.data.stores?.[id]) return id === to ? from : id === from ? to : null;
    const p = N()[id]?.parent;
    return p === "root" ? home() : p;
  }, ids.length);
  const gIn = move.kind === "in" ? boxOf(old, move.via) : move.kind === "out" ? boxOf(next, move.via) : null;
  if ((move.kind === "in" || move.kind === "out") && (!gIn || !full.w)) move = side;
  if (move.kind === "shuffle" && !full.w) move = { kind: "fade" };
  const oldView = old.getAttribute("viewBox")!.split(" ").map(Number);
  const nextView = next.getAttribute("viewBox")!.split(" ").map(Number);
  const ctx = (id: string) => st.data.boards[id]?.context ?? [];

  if (move.kind === "in") {
    const b = rel(gIn!, old);
    const start = fit(contentRect(nextView, box.width, box.height), b);
    glide(next, old, ctx(to), start, nextView, true);
    // the old board is gone before the new one settles, so the two never read as one muddle
    play(old, [{ transform: "none", opacity: 1 }, { opacity: 0, offset: 0.65 }, { transform: css(fit(b, full)), opacity: 0 }]);
    play(next, [{ transform: css(start), opacity: 0 }, { opacity: 1, offset: 0.45 }, { transform: "none", opacity: 1 }]);
  } else if (move.kind === "out") {
    const b = rel(gIn!, next);
    const end = fit(contentRect(oldView, box.width, box.height), b);
    glide(old, next, ctx(from), end, oldView, false);
    play(next, [{ transform: css(fit(b, full)), opacity: 0 }, { opacity: 1, offset: 0.45 }, { transform: "none", opacity: 1 }]);
    play(old, [{ transform: "none", opacity: 1 }, { opacity: 0.6, offset: 0.4 }, { transform: css(end), opacity: 0 }]);
  } else if (move.kind === "shuffle") {
    shuffling = true;
    glide(next, old, ids, { s: 1, x: 0, y: 0 }, nextView, true);
    const mine = new Set(ids.map((id) => `n:${id}`));
    const fade = (svg: SVGSVGElement, frames: Keyframe[]) => {
      for (const g of svg.querySelectorAll<SVGGElement>(":scope > g")) {
        if (mine.has(g.dataset.hit ?? "")) { if (svg === old) play(g, [{ opacity: 0 }, { opacity: 0 }]); } else play(g, frames);
      }
    };
    fade(old, [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }]);
    fade(next, [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }]);
  } else {
    play(next, [{ opacity: 0 }, { opacity: 1 }], pace.fade);
    play(old, [{ opacity: 1 }, { opacity: 0 }], pace.fade);
  }
  const mine = running;
  done = Promise.all(mine.map((a) => a.finished)).then(() => { if (running === mine) finishTransition(); }, () => {});
}
