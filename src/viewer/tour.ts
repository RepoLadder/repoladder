// The one tour player (#192): plays any tour (tourstep.ts), a board's own or the grouping's, one at a
// time. Every step looks the same: its boxes and arrows lit, the rest dimmed (passed steps too), its
// arrows pulsing (pulse.ts), and the board framed on it (walkfit.ts). The card is the strip under the
// canvas (on a phone, on the canvas under the board). Next/Back or ←/→ step; Escape, Skip, a click on
// empty canvas or on another board leaves, and picking a box or an arrow leaves for its details.
// A step plays at its dial stop (#195): the dial follows it, and the stop you had before the tour
// comes back when it ends or is left; turning the dial by hand leaves it, at the stop you picked.
import { pulse, stopPulse } from "./pulse.ts";
import { setSnap } from "./sheet.ts";
import { show } from "./navigate.ts";
import { turn } from "./dial.ts";
import { featuresOf } from "../features.ts";
import { landOn, mapStep } from "./dialmap.ts";
import { boardAtStop, currentStop, onStop, stopDefs } from "./stopview.ts";
import type { StopBoard } from "./stops.ts";
import { finishTravel, travel } from "./travel.ts";
import type { Tour } from "../model/compose.ts";
import { auditStep, begin, litMarks, shownArrows, stepBy, type Playing, type PlayTour, type Step } from "./tourstep.ts";
import { findTour } from "./walk.ts";
import { $, board, nameOf, st } from "./state.ts";
import { cardHtml } from "./tourcard.ts";
import { walkAction } from "./walkorder.ts";
import { stopWalkGlide, walkFrame, walkUnframe, type Rect } from "./walkfit.ts";

let now: Playing = null;
/** The board the player last painted (a step's board change shows a new svg). */
let painted: SVGSVGElement | null = null;
/** Moves in progress by the player itself (travel.ts), so show() on the way doesn't end the tour. */
let moving = 0;
/** The dial stop on screen when the tour began: it comes back when the tour ends or is left. */
let before = "default";

export const playingId = (): string | undefined => now?.tour.id;
/** The stop leaving the tour lands on: a tour link opened cold sets the viewer's remembered one (dial.ts). */
export const stopAfter = (k: string): void => void (before = k);
const hits = () => [...st.svgEl.querySelectorAll<SVGGElement>("g[data-hit]")];
const phone = () => matchMedia("(max-width: 760px)").matches;

/**
 * Shows `board` at dial stop `stop`: the one place a tour changes board, up, across `edge` and down
 * (travel.ts). Resolves once the move ends; Next mid-move starts the next one, which jumps this to its end.
 */
function moveTo(board: string, stop: string, edge?: [string, string]): Promise<unknown> | void {
  // a stop this repo lacks plays at its nearest, as the dial would land on it
  stop = landOn(stop, stopDefs().map((d) => d.key));
  if (st.cur === board && currentStop() === stop) return;
  moving++;
  // the stop change rides inside the move (on its way down)
  return travel({ board: st.cur, stop: currentStop() }, { board, stop }, edge).finally(() => moving--);
}

const watchers: ((tour: Tour | null, step: number) => void)[] = [];
/** `f` hears every step shown (0-based) and, with null, the tour ending (docs/tours-v2.md: the trail, deep links). */
export const onTourStep = (f: (tour: Tour | null, step: number) => void): void => void watchers.push(f);

/** Plays the tour `id` (the grouping's, or this board's `@<flow>` / `@read`) from step `step` (0-based). */
export function playTour(id: string, step = 0): void {
  const t = findTour(id);
  if (t) play(t, step);
}

/** Starts `tour` at step `i`, ending the one playing (`toggle`: its own row again just leaves). `at` freezes the pulse. */
export function play(tour: PlayTour, i = 0, at?: number, toggle = false): void {
  const next = begin(now, tour, i, toggle);
  // one tour straight into another keeps the stop from before the first
  if (now) leaveTour(true, !next);
  else before = currentStop();
  now = next;
  if (now) go(at);
}

function go(at?: number): void {
  const s0 = now!.tour.steps[now!.i], id = now!.tour.id, i = now!.i;
  // a step whose board has no layer at its stop plays on the nearest board that does (#327), its lit ids mapped
  const stop = landOn(s0.stop, stopDefs().map((d) => d.key)), b = boardAtStop(stop, s0.board);
  const p = moveTo(b, stop, b === s0.board ? s0.lit.edges[0] : undefined);
  // a step authored at another stop is mapped too when the stop landed elsewhere (dial off: everything plays at Default)
  const asAuthored = b === s0.board && (stop === s0.stop || featuresOf(st.data).dial);
  const step = (): Step => (asAuthored ? s0 : mapStep(s0, b, st.data.boards[b] as StopBoard, st.data.tree ?? st.data.nodes, st.data.paths));
  if (p) void p.then(() => { if (now?.tour.id === id && now.i === i && st.cur === b) render(step(), at); });
  else render(step(), at);
}

/** The step's lit boxes and arrows, in board units. */
function litRect(): Rect | null {
  const bs = hits().filter((g) => g.classList.contains("wk-now")).map((g) => g.getBBox?.()).filter((b): b is DOMRect => !!b && !!(b.width || b.height));
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.width)) - x, h: Math.max(...bs.map((b) => b.y + b.height)) - y };
}

/** The step as drawn: the authored one, or mapped onto the nearest board that exists at its stop (go). */
let shown: Step | null = null;
/** The shown step's real edges the board does not draw (tourstep.ts auditStep), noted on the card. */
let hidden: [string, string][] = [];

function render(s: Step, at?: number): void {
  shown = s;
  const entering = painted !== st.svgEl;
  paint(at);
  // the player draws nothing (docs/tours-v2.md): a real edge the board leaves out is only said on the card
  audit(s);
  sync();
  // on a phone the sheet drops to its peek, so the strip and the board above it are in view
  if (entering && phone()) setSnap("peek");
  else if (entering) document.querySelector(".walk-card")?.scrollIntoView?.({ block: "nearest" });
  walkFrame(entering, litRect());
  for (const f of watchers) f(now!.tour, now!.i);
}

/** What the board draws of the step's edges now; the rest is noted on the card (arrows the filters reveal count as drawn). */
function audit(s: Step): void {
  const keys = hits().map((g) => g.dataset.hit!).filter((h) => h.startsWith("e:")).map((h) => h.slice(2));
  hidden = auditStep(s, (board()?.edges ?? []).map((e) => `${e.a}>${e.b}`), keys).hidden;
}

/** Marks every drawn element for the step, and pulses its arrows. */
function paint(at?: number): void {
  const svg = st.svgEl, gs = hits();
  svg.classList.toggle("walking", !!now);
  gs.forEach((g) => g.classList.remove("wk-now", "wk-off"));
  if (!now) return stopPulse(svg);
  painted = svg;
  const s = shown ?? now.tour.steps[now.i], m = litMarks(s, gs.map((g) => g.dataset.hit!));
  gs.forEach((g) => g.classList.add(`wk-${m.get(g.dataset.hit!)}`));
  const arrows = shownArrows(s, gs.map((g) => g.dataset.hit!));
  pulse(svg, [arrows.map((a) => a.key)], at);
}

function card(): string {
  if (!now) return "";
  const { tour, i } = now, s = tour.steps[i];
  return cardHtml({ i, n: tour.steps.length, title: tour.title, caption: s.caption, notes: s.notes ?? [], undrawn: hidden.map(([a, b]) => [nameOf(a), nameOf(b)]) });
}

/** Whether the card sits on the canvas: always, except embedded mode and full screen (a framed canvas, the card below it, #164). */
const onCanvas = (): boolean => phone() || !(document.documentElement.classList.contains("embed") || document.fullscreenElement);

/** The card: a strip on the canvas under the board, floating over the full-window canvas (embedded: below it). */
function sync(): void {
  document.querySelectorAll<HTMLElement>("[data-tour]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tour === now?.tour.id)));
  const c = $("canvas"), html = card();
  c.style.removeProperty("--walk-h");
  document.querySelector(".walk-card")?.remove();
  c.classList.toggle("walking", !!html);
  if (!html) return;
  c.insertAdjacentHTML(onCanvas() ? "beforeend" : "afterend", html);
  if (onCanvas()) c.style.setProperty("--walk-h", `${c.querySelector<HTMLElement>(".walk-card")!.offsetHeight}px`);
}

/**
 * Ends the tour playing. `restore`: glide back to the board's fit (not when another board opened).
 * `stop`: turn the dial back to the stop from before the tour (not when the dial itself was turned).
 */
export function leaveTour(restore = true, stop = true): void {
  if (!now) return;
  now = null;
  painted = null;
  finishTravel();
  hidden = [];
  paint();
  sync();
  walkUnframe(restore);
  for (const f of watchers) f(null, 0);
  // after the show() that left it has drawn its board; turn() keeps the selection on what holds it
  if (stop && currentStop() !== before) queueMicrotask(() => void turn(before, false));
}

function stepTo(next: Playing): void {
  if (!next) return leaveTour();
  now = next;
  go();
}

/** Called by show(): the player's own board change keeps playing; any other leaves the tour. */
export function tourShown(): void {
  if (moving) return walkUnframe(false);
  if (now) { stopPulse(painted); leaveTour(false); }
}

export function installTours(): void {
  // a stop turned by anything but the player (the dial by hand, the script hook) leaves the tour there
  onStop(() => { if (now && !moving) leaveTour(false, false); });
  const stop = (ev: Event) => { if (!(ev.target as Element).closest?.(".walk-card")) stopWalkGlide(); };
  $("canvas").addEventListener("wheel", stop, { passive: true });
  $("canvas").addEventListener("pointerdown", stop);
  document.addEventListener("click", (ev) => {
    if (!now) return;
    const t = ev.target as Element, b = t.closest<HTMLElement>("[data-tour-step],[data-tour-exit]");
    if (b) return b.dataset.tourStep ? stepTo(stepBy(now, Number(b.dataset.tourStep))) : leaveTour();
    if (t.closest("[data-tour]")) return;
    // navigate.ts ran first, so a picked box or arrow is already selected
    if (walkAction({ picked: !!st.selected, canvas: !!t.closest("svg.board"), box: !!t.closest("g[data-hit]"), dragged: st.dragged })) return leaveTour();
    // the phone sheet: a tap on the card but its buttons steps on
    if (t.closest(".walk-card") && !t.closest("button,a") && phone()) return stepTo(stepBy(now, 1));
    // a filter toggle redraws the extra wires; keep the step's look
    if (painted === st.svgEl) { paint(); audit(shown ?? now.tour.steps[now.i]); sync(); }
  });
  // crossing the phone width moves the card between the canvas and the page below it
  matchMedia("(max-width: 760px)").addEventListener?.("change", () => now && sync());
  // capture phase: Escape leaves the tour first, before it clears a selection or climbs a level
  window.addEventListener("keydown", (ev) => {
    if (!now || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if ((ev.target as Element).closest?.("input,textarea,select")) return;
    const a = walkAction({ key: ev.key });
    if (!a) return;
    ev.preventDefault();
    ev.stopPropagation();
    // keys stop at the ends; Done (or Escape) leaves
    if (a === "leave") leaveTour();
    else stepTo(stepBy(now, a === "next" ? 1 : -1, true));
  }, true);
}
