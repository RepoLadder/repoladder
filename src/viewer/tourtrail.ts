// The breadcrumb trail during a tour (docs/tours-v2.md, "Staying oriented"): the breadcrumb lights
// the levels the tour has passed through, and the tour strip shows the step's path, small, above the
// caption ("Cloud backend › Check-in & notifications"). Both follow the player through onTourStep,
// so they update however the step's board is reached (a cut, a zoom, or travel's up/across/down).
import { collapse, crumbLabel, lightCrumbs, trailIds } from "./crumbs.ts";
import type { Tour, TourStep } from "../model/compose.ts";
import { onTourStep } from "./tour.ts";
import { N, esc, home, nameOf, st } from "./state.ts";

/** The deepest board above both `a` and `b` (or either), as the breadcrumbs see the tree. */
export function commonLevel(a: string, b: string): string {
  const x = trailIds(a), y = trailIds(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i ? x[i - 1] : home();
}

/**
 * The boards a tour has been on by step `i`: every step's board so far, and between two steps on
 * different branches the level the move climbed through (their common parent). Stepping Back
 * un-lights, so the set only depends on where the tour is.
 */
export function passedBoards(boards: string[], i: number): Set<string> {
  const out = new Set<string>();
  boards.slice(0, i + 1).forEach((b, k) => {
    if (k > 0 && boards[k - 1] !== b) out.add(commonLevel(boards[k - 1], b));
    out.add(b);
  });
  return out;
}

/**
 * The part of board `board` a step is in: of the lit arrow's start, its end, then the lit boxes,
 * the first that is one of the board's own parts, else the first drawn on it that isn't an
 * "elsewhere" box. Starting from the arrow's start keeps the path steady while a tour follows the
 * arrows out of one part (the caption already names where each arrow goes).
 */
function partOf(s: Pick<TourStep, "board" | "lit">): string | undefined {
  const b = st.data.boards[s.board];
  const cands = [...(s.lit.edges[0] ?? []), ...s.lit.boxes].filter((id) => id !== s.board);
  return cands.find((id) => N()[id]?.parent === s.board) ?? cands.find((id) => b?.nodes.includes(id) && !b.context.includes(id));
}

/**
 * The step's place, outermost first: the levels down to its board (without the overview, which
 * every path starts from, unless the step is on it), then the part of that board the step is in.
 */
export function stepPath(s: Pick<TourStep, "board" | "lit">): string[] {
  const levels = trailIds(s.board).filter((id) => id !== home());
  const out = (levels.length ? levels : [home()]).map(crumbLabel);
  const part = partOf(s);
  if (part) out.push(nameOf(part));
  return out;
}

let now: { tour: Tour; i: number } | null = null;
let watch: MutationObserver | null = null;

/** The tour strip's card, at the bottom (tour.ts). */
const strip = (): HTMLElement | null => document.querySelector<HTMLElement>(".walk-card");

const pathHtml = (segs: string[], plan: number[]) => plan.map((k, j) => {
  const sep = j ? `<span aria-hidden="true">›</span>` : "";
  if (k < 0) return `${sep}<span class="tp-more" title="${esc(segs.filter((_, m) => !plan.includes(m)).join(" › "))}">…</span>`;
  return `${sep}<span${k === segs.length - 1 ? ` class="tp-here"` : ""}>${esc(segs[k])}</span>`;
}).join("");

/** Puts the path line in the strip, above the caption, when the strip was (re)drawn without it. */
function place(): void {
  const card = strip();
  if (!now || !card || card.querySelector(".tour-path")) return;
  const segs = stepPath(now.tour.steps[now.i]);
  const el = document.createElement("p");
  el.className = "tour-path";
  el.setAttribute("aria-label", `Where: ${segs.join(", ")}`);
  const text = card.querySelector(".tour-text");
  if (text) text.before(el);
  else card.prepend(el);
  // on a phone the middle levels fold into "…" before the step's own name is cut short
  const fits = (plan: number[]) => { el.innerHTML = pathHtml(segs, plan); return el.scrollWidth <= el.clientWidth + 0.5; };
  el.innerHTML = pathHtml(segs, collapse(segs.length, fits));
  // on a phone the strip sits in the canvas's dock, measured by tour.ts before this line was in it
  const c = document.getElementById("canvas");
  if (c?.style.getPropertyValue("--walk-h")) c.style.setProperty("--walk-h", `${card.offsetHeight}px`);
}

function stepped(tour: Tour | null, i: number): void {
  document.querySelectorAll(".tour-path").forEach((p) => p.remove());
  now = tour && tour.steps[i] ? { tour, i } : null;
  lightCrumbs(now ? passedBoards(tour!.steps.map((s) => s.board), i) : new Set());
  if (!now) { watch?.disconnect(); watch = null; return; }
  place();
  // the player may draw (or redraw) its strip after telling us, so follow the DOM while a tour plays
  if (!watch) {
    watch = new MutationObserver(place);
    watch.observe(document.body, { childList: true, subtree: true });
  }
}

export function installTourTrail(): void {
  onTourStep(stepped);
  // a tour link opened cold plays before the fonts arrive: fold the path again with the real widths
  document.fonts?.ready?.then(() => { document.querySelectorAll(".tour-path").forEach((p) => p.remove()); place(); });
}
