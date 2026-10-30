// The one tour model (#192, shapes from docs/tours-v2.md). A tour is a list of steps; each step names a
// board and dial stop, what is lit there (boxes and arrows; the rest dims) and a caption. A board's
// flows and its layer-by-layer reading are single-board tours (walk.ts); the grouping's tours are
// multi-board ones. One player plays them all (tour.ts). Pure, so node tests cover it.
import type { Tour, TourStep } from "../model/compose.ts";
import type { ModelFlow } from "../model/flows.ts";
import type { ModelTour } from "../model/tours.ts";
import { caption, rankOf, readLit, type Mark } from "./readorder.ts";
import type { PageEdge } from "./state.ts";
import { hopCaption, hops } from "./walkorder.ts";

/** A step as the page plays it: `notes` go under the caption (wide screens). */
export type Step = TourStep & { notes?: [string, string][] };
/** `id`: the grouping tour's id, or `@<flow index>` / `@read` for a board's own tours. */
export type PlayTour = Omit<Tour, "steps"> & { steps: Step[] };

export type PageFlow = Omit<ModelFlow, "named">;
type Name = (id: string) => string;
const pair = (k: string) => k.split(">") as [string, string];

/**
 * A grouping tour (or a derived one): one step per edge, part or composed hop, each on the board the
 * build placed it on, at its stop (Default unless named). A composed step lights its own `lit`; an
 * edge step lights its two boxes and its arrow where the board draws it (the player draws nothing itself).
 */
export const fromModel = (t: ModelTour): PlayTour => ({
  id: t.id,
  title: t.title,
  source: t.source ?? "claude",
  steps: t.steps.map((s): Step => {
    const at = { board: s.board, stop: s.stop ?? "default", caption: s.text };
    // a composed step (chain or derived) lights what is drawn at its stop
    if (s.lit) return { ...at, lit: s.lit, ...(s.via ? { via: s.via } : {}) };
    return s.edge ? { ...at, lit: { boxes: [...s.edge], edges: [[...s.edge]] } } : { ...at, lit: { boxes: [s.node!], edges: [] } };
  }),
});

/** Flow `i` of `board`, played at `stop`: one step per hop, its arrow and two boxes lit. */
export function flowTour(board: string, i: number, f: PageFlow, edges: PageEdge[], name: Name, stop = "default"): PlayTour {
  return {
    id: `@${i}`,
    title: f.title,
    source: "flow",
    steps: hops(f.path).map((h, k) => {
      const a = f.path[k], b = f.path[k + 1];
      return { board, stop, lit: { boxes: [a, b], edges: [pair(h)] }, caption: hopCaption(a, b, edges.find((e) => e.a === a && e.b === b), name, f.captions?.[k]) };
    }),
  };
}

/**
 * The fallback tour of a board without flows: its layers in reading order (readorder.ts). `shown`: the
 * drawn arrows (`a>b`), the only ones a caption mentions or a step lights; `note`: a box's summary line.
 */
export function readTour(board: string, layers: string[][], edges: PageEdge[], shown: Set<string>, name: Name, note: (id: string) => [string, string] | undefined, stop = "default"): PlayTour {
  const rank = rankOf(layers), arrows = [...shown];
  return {
    id: "@read",
    title: "The whole board, layer by layer",
    source: "flow",
    steps: layers.map((ids, k) => {
      const l = readLit(rank, arrows, k);
      return { board, stop, lit: { boxes: l.boxes, edges: l.arrows.map(pair) }, caption: caption(k, layers, edges, shown, name), notes: ids.map(note).filter((x) => !!x).slice(0, 2) };
    }),
  };
}

/** A step's arrows as hit keys `a>b` (the pulse's wave). */
export const arrowsOf = (s: TourStep) => s.lit.edges.map(([a, b]) => `${a}>${b}`);

/**
 * The step's arrows as the board draws them (`hits`: its `e:a>b` keys): only its own, forward way. An
 * arrow the board doesn't draw is left out; the player never draws one (docs/tours-v2.md), and a drawn
 * reverse arrow states a connection the step did not name, so it is never lit either.
 */
export function shownArrows(s: TourStep, hits: Iterable<string>): { key: string }[] {
  const has = new Set(hits);
  return s.lit.edges.filter(([a, b]) => has.has(`e:${a}>${b}`)).map(([a, b]) => ({ key: `${a}>${b}` }));
}

/**
 * Checks a step's edges against the board (the viewer's boundary, and what a generated guide can call):
 * `real` the board's edge keys `a>b`, `drawn` the keys of the arrows in the DOM. Forward direction only.
 * `drawn`: lit as an arrow; `hidden`: a real edge the board doesn't draw (the card says so); `invented`: no such edge.
 */
export function auditStep(s: TourStep, real: Iterable<string>, drawn: Iterable<string>): { drawn: [string, string][]; hidden: [string, string][]; invented: [string, string][] } {
  const r = new Set(real), d = new Set(drawn), out = { drawn: [] as [string, string][], hidden: [] as [string, string][], invented: [] as [string, string][] };
  for (const [a, b] of s.lit.edges) out[d.has(`${a}>${b}`) ? "drawn" : r.has(`${a}>${b}`) ? "hidden" : "invented"].push([a, b]);
  return out;
}

/** How each drawn element (`n:<id>`, `e:<a>><b>`) looks at step `s`: lit, or dimmed with the rest (never hidden). */
export function litMarks(s: TourStep, hits: string[]): Map<string, Mark> {
  const on = new Set([...s.lit.boxes.map((b) => `n:${b}`), ...shownArrows(s, hits).map((a) => `e:${a.key}`)]);
  return new Map(hits.map((h) => [h, on.has(h) ? "now" : "off"]));
}

/** What is playing: one tour at one step, or nothing. */
export type Playing = { tour: PlayTour; i: number } | null;

/**
 * Starting a tour ends the one playing: there is only ever one. Picking the playing tour's row again
 * (`toggle`) leaves it instead. The step is clamped to the tour.
 */
export function begin(now: Playing, tour: PlayTour, i = 0, toggle = false): Playing {
  if (toggle && now?.tour.id === tour.id) return null;
  return tour.steps.length ? { tour, i: Math.max(0, Math.min(i, tour.steps.length - 1)) } : null;
}

/** `d` steps on: past the last step leaves (Done), before the first stays; keys (`clamp`) stop at both ends. */
export function stepBy(now: Playing, d: number, clamp = false): Playing {
  if (!now) return null;
  const n = now.tour.steps.length, j = now.i + d;
  if (clamp || j < 0) return { ...now, i: Math.max(0, Math.min(n - 1, j)) };
  return j >= n ? null : { ...now, i: j };
}
