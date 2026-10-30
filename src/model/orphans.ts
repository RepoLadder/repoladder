// No box left floating (#126): the major-edge budgets hide minor edges, and a box whose every edge
// was hidden reads as unused. Each such box gets its strongest existing edge drawn back. Nothing is
// invented: only edges already on the board (with their evidence) are promoted.
import type { RollEdge } from "./rollrules.ts";

const weight = (e: RollEdge) => e.imports + e.calls * 3 + e.uses;
const byStrength = (x: RollEdge, y: RollEdge) => (y.calls > 0 ? 1 : 0) - (x.calls > 0 ? 1 : 0) || weight(y) - weight(x) || x.a.localeCompare(y.a) || x.b.localeCompare(y.b);

/**
 * Promotes, for each box in `boxes` that no major edge touches, its strongest edge: first among
 * edges whose other end is already drawn (`shown`), then among those to a box `may` allow onto the
 * board (an "elsewhere" part). Returns the edges it promoted.
 */
export function connectOrphans<E extends RollEdge>(edges: E[], boxes: string[], shown: Iterable<string>, may: (id: string) => boolean = () => false): E[] {
  const on = new Set(shown);
  const touched = new Set(edges.filter((e) => e.major).flatMap((e) => [e.a, e.b]));
  const promoted: E[] = [];
  for (const id of boxes) {
    if (touched.has(id)) continue;
    const mine = edges.filter((e) => !e.major && (e.a === id || e.b === id) && e.a !== e.b);
    const other = (e: E) => (e.a === id ? e.b : e.a);
    const pick = mine.filter((e) => on.has(other(e))).sort(byStrength)[0] ?? mine.filter((e) => may(other(e))).sort(byStrength)[0];
    if (!pick) continue;
    pick.major = true;
    promoted.push(pick);
    touched.add(pick.a).add(pick.b);
    on.add(other(pick));
  }
  return promoted;
}
