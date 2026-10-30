// A board's flows as tour steps (tourstep.ts), and the tour player's keys and clicks, pure so node
// tests cover them. A flow is walked one arrow (hop) at a time.
import { verb } from "./readorder.ts";
import type { PageEdge } from "./state.ts";

/** Hops of a flow: each consecutive pair of its path, as a drawn-arrow hit key `a>b`. */
export const hops = (path: string[]) => path.slice(1).map((b, k) => `${path[k]}>${b}`);

/** One line for a hop: the grouping's caption when it named the flow, else what the arrow does. */
export function hopCaption(a: string, b: string, e: PageEdge | undefined, name: (id: string) => string, named?: string): string {
  return named ?? `${name(a)} ${e ? verb([e]) : "uses"} ${name(b)}.`;
}

/** What ends or moves a walkthrough. A click: `picked` a box or arrow (selected now), on `canvas` empty space or a box, after a pan drag. */
export type WalkInput = { key: string } | { picked: boolean; canvas: boolean; box: boolean; dragged: boolean };

/**
 * Escape leaves the walkthrough before anything else (clearing a selection, climbing a level), the
 * same order as a selection; so does a click on empty canvas that was not a pan. Picking a box or an
 * arrow leaves for its details. ←/→ step.
 */
export function walkAction(i: WalkInput): "leave" | "next" | "prev" | null {
  if ("key" in i) return i.key === "Escape" ? "leave" : i.key === "ArrowRight" ? "next" : i.key === "ArrowLeft" ? "prev" : null;
  return i.picked || (i.canvas && !i.box && !i.dragged) ? "leave" : null;
}

/**
 * Arrows (`a>b`) in waves along their direction, for a pulse that travels: the first wave leaves
 * boxes no other arrow here points into, each next wave leaves where the last one arrived. Arrows a
 * cycle keeps out go in one last wave.
 */
export function waves(edges: string[]): string[][] {
  const es = [...new Set(edges)].sort().map((k) => k.split(">") as [string, string]);
  const into = new Set(es.map(([, b]) => b));
  let at = new Set(es.map(([a]) => a).filter((a) => !into.has(a)));
  const done = new Set<number>(), out: string[][] = [];
  while (at.size) {
    const w = es.flatMap((e, i) => (!done.has(i) && at.has(e[0]) ? [i] : []));
    if (!w.length) break;
    w.forEach((i) => done.add(i));
    out.push(w.map((i) => es[i].join(">")));
    at = new Set(w.map((i) => es[i][1]));
  }
  const rest = es.flatMap((e, i) => (done.has(i) ? [] : [e.join(">")]));
  if (rest.length) out.push(rest);
  return out;
}
