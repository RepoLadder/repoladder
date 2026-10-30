// The connection panel's counts. Arrows on the board carry no numbers (the owner's taste round:
// "If I want to see detail like that, I'd just want to click the arrow"), so they live here.
import type { PageEdge } from "./state.ts";

/** Each nonzero count as [number, what]: imports, calls, SDK imports; or, for a store arrow, reads and writes. */
export function edgeCounts(e: PageEdge): [number, string][] {
  // a store arrow is about data; its SDK imports only repeat that the code talks to the store
  const data = !!(e.reads || e.writes);
  const all: [number, string, string][] = data
    ? [[e.reads ?? 0, "read", "reads"], [e.writes ?? 0, "write", "writes"]]
    : [[e.imports, "import", "imports"], [e.calls, "call by name", "calls by name"], [e.uses, "SDK import", "SDK imports"]];
  return all.filter(([n]) => n > 0).map(([n, one, many]) => [n, n === 1 ? one : many]);
}

/** The counts as a row of tiles: big number, its unit below. */
export function countTiles(e: PageEdge): string {
  const cs = edgeCounts(e);
  return cs.length ? `<ul class="counts">${cs.map(([n, w]) => `<li><b>${n.toLocaleString()}</b><span>${w}</span></li>`).join("")}</ul>` : "";
}
