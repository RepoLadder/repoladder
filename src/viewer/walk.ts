// What there is to play (#192): the grouping's tours, and a board's own tours, its flows
// (model/flows.ts) or else, with more than one layer, the board layer by layer (readorder.ts). The
// panel lists them under "Tours" (the overview lists the grouping's too) and the one player
// (tour.ts) plays them. `__repoladder.walk(i | "read", step, at)` and `.tour(id, step)` for scripts.
import type { BoardLayout } from "../build/layout.ts";
import { box } from "./box.ts";
import { onEvery } from "./everydraw.ts";
import { stepsOf } from "./readorder.ts";
import { currentStop } from "./stopview.ts";
import { leaveTour, play, playingId } from "./tour.ts";
import { flowTour, fromModel, readTour, type PlayTour } from "./tourstep.ts";
import { N, STORY, board, esc, isCtx, nameOf, onStoreBoard, plural, st } from "./state.ts";

const readCache = new WeakMap<BoardLayout, string[][]>();
const short = (id: string) => nameOf(id).replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
/** Board tours play at the stop on screen (a board of containers is read layer by layer). */
const stopHere = () => currentStop();

function readOf(): PlayTour | null {
  const l = st.data.layout[st.cur];
  // Everything (hundreds of boxes) has no reading order worth walking
  if (!l || st.cur === STORY || onStoreBoard() || onEvery()) return null;
  if (!readCache.has(l)) readCache.set(l, stepsOf(l));
  const layers = readCache.get(l)!;
  if (layers.length < 2) return null;
  const shown = new Set([...st.svgEl.querySelectorAll<SVGGElement>("g[data-hit^='e:']")].filter((g) => !g.classList.contains("f-off")).map((g) => g.dataset.hit!.slice(2)));
  // the grouping's summaries of a step's parts (file boxes have none; an elsewhere box's is about another part)
  const note = (id: string): [string, string] | undefined => (!isCtx(id) && N()[id]?.summary ? [nameOf(id), N()[id].summary!] : undefined);
  return readTour(st.cur, layers, board().edges, shown, short, note, stopHere());
}

/** This board's own tours: its flows, or else its reading. */
function boardTours(): PlayTour[] {
  const flows = st.cur === STORY ? [] : st.data.flows?.[st.cur] ?? [];
  if (flows.length) return flows.map((f, i) => flowTour(st.cur, i, f, board().edges, short, stopHere()));
  const r = readOf();
  return r ? [r] : [];
}

/** The grouping's tours, listed on the overview (and the story level). */
// derived tours (model/derivedtours.ts) are already steps; they list after the grouping's
/** Also `__repoladder.tours()`, for scripts/readme-media.ts. */
export const groupTours = (): PlayTour[] => [...(st.data.tours ?? []).map(fromModel), ...(st.data.derivedTours ?? [])];
const listed = () => [...(st.cur === "root" || st.cur === STORY ? groupTours() : []), ...boardTours()];

/** The panel's "Tours" block: empty where there are none. */
export const tourRows = (): { id: string; title: string; steps: number }[] => listed().map((t) => ({ id: t.id, title: t.title, steps: t.steps.length }));

export function tourList(open = false): string {
  const ts = listed();
  if (!ts.length) return "";
  const rows = ts.map((t) => `<li><button class="item" data-tour="${esc(t.id)}" aria-pressed="${playingId() === t.id}"><span>${esc(t.title)}</span><span class="num">${plural(t.steps.length, "step")}</span></button></li>`).join("");
  return box("Tours", `<ul class="list">${rows}</ul>`, { open, cls: "walk walk-panel" });
}

/** A tour by id: the grouping's (from any board), or one of this board's own (`@<flow>`, `@read`). */
export const findTour = (id: string): PlayTour | undefined => [...groupTours(), ...boardTours()].find((x) => x.id === id);

/**
 * For scripts (shots, frame strips): this board's walk `w` (a flow index, or "read") at
 * step `step` (1-based, or "last"), the pulse frozen at fraction `at` of that step's arrows; null
 * leaves. Returns the number of steps (0: no such walk).
 */
export function walkHook(w: number | "read" | null, step: number | "last" = 1, at?: number): number {
  if (w === null) { leaveTour(); return 0; }
  const t = w === "read" ? readOf() : boardTours().find((x) => x.id === `@${w}`);
  if (!t) return 0;
  const n = t.steps.length;
  play(t, step === "last" ? n - 1 : step - 1, at);
  return n;
}

export function installTourList(): void {
  document.addEventListener("click", (ev) => {
    const key = (ev.target as Element).closest<HTMLElement>("[data-tour]")?.dataset.tour;
    const t = key === undefined ? null : findTour(key);
    // picking the playing tour's row again leaves it
    if (t) play(t, 0, undefined, true);
  });
}
