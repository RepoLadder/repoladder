// A merged stop's store collections (viewer/stops.ts): which of a board's boxes read and write
// each collection. The page has them per Default board, so a board that draws boxes from several
// Default boards joins their lists. Pure: no DOM.
import type { PageCollection, PathRef, ViewerData } from "./state.ts";

const EVIDENCE_PER_COLLECTION = 3;

/**
 * Per store in `used`: its collections that `boxes` read or write. Evidence keeps rollup.ts's rule
 * (one example per box and operation first, up to 3) over the rows the Default boards kept, so it
 * can show fewer rows than a build of this tree would.
 */
export function storeCollections(data: ViewerData, boxes: string[], used: Set<string>, partOf: (file: number) => string | null): Record<string, PageCollection[]> | undefined {
  const P = data.paths;
  const path = (f: PathRef) => (typeof f === "number" ? P[f] : f);
  const on = new Set(boxes);
  const byStore = new Map<string, Map<string, { reads: Set<string>; writes: Set<string>; ev: [PathRef, number][] }>>();
  for (const parent of [...new Set(boxes.map((x) => data.nodes[x]?.parent).filter((p): p is string => !!p))]) {
    for (const [sid, cs] of Object.entries(data.boards[parent]?.collections ?? {})) {
      if (!used.has(sid)) continue;
      for (const [name, reads, writes, ...ev] of cs) {
        const r = reads.filter((x) => on.has(x)), w = writes.filter((x) => on.has(x));
        if (!r.length && !w.length) continue;
        let m = byStore.get(sid);
        if (!m) byStore.set(sid, (m = new Map()));
        let c = m.get(name);
        if (!c) m.set(name, (c = { reads: new Set(), writes: new Set(), ev: [] }));
        r.forEach((x) => c.reads.add(x));
        w.forEach((x) => c.writes.add(x));
        for (let i = 0; i + 1 < ev.length; i += 2) c.ev.push([ev[i], ev[i + 1] as number]);
      }
    }
  }
  if (!byStore.size) return undefined;
  const order = (ids: Set<string>) => [...ids].sort((x, y) => boxes.indexOf(x) - boxes.indexOf(y));
  const part = (f: PathRef) => partOf(typeof f === "number" ? f : P.indexOf(f));
  return Object.fromEntries([...byStore].sort((x, y) => x[0].localeCompare(y[0])).map(([sid, m]) => [sid,
    [...m].sort((x, y) => x[0].localeCompare(y[0])).map(([name, c]): PageCollection => {
      const ev: [PathRef, number][] = [];
      for (const row of c.ev.sort((x, y) => path(x[0]).localeCompare(path(y[0])) || Math.abs(x[1]) - Math.abs(y[1]))) {
        if (ev.length >= EVIDENCE_PER_COLLECTION) break;
        const p = part(row[0]);
        if (p && on.has(p) && !ev.some((x) => Math.sign(x[1]) === Math.sign(row[1]) && part(x[0]) === p)) ev.push(row);
      }
      return [name, order(c.reads), order(c.writes), ...ev.flat()];
    })]));
}
