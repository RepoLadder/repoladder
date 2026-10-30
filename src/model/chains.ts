// findChains (docs/tours-data.md): the chains of real file-to-file edges from one file or group to
// another, or to the services and stores the code ends at. A bounded, deterministic search over
// fgraph, for derived tours and for an agent answering "walk me through check-in".
import { filesUnder, indexOf, isSink, type Index, type TourGraph } from "./tourgraph.ts";

export interface ChainOptions {
  /** How many chains to return (default 5). */
  max?: number;
  /** The most file-to-file hops in a chain (default 6). */
  maxLen?: number;
}

/** Work cap: paths extended before the search gives up looking for more. */
const BUDGET = 20000;

/**
 * Chains from `from` (a file path or group id) to `to`: a file path or group id, a sink ("svc-…" or
 * "store-…", which then ends each chain), or, when omitted, any sink. Each chain is repo paths,
 * consecutive pairs real fgraph edges, ready for composeTour. A chain stops at the first file that
 * reaches the target, never visits a file twice, and never starts inside `to`. Shortest first, then
 * the ones that cross more parts, then by path.
 */
export function findChains(g: TourGraph, from: string, to?: string, opts: ChainOptions = {}): string[][] {
  const ix = indexOf(g);
  const max = opts.max ?? 5, maxLen = opts.maxLen ?? 6;
  const sources = filesUnder(ix, from);
  // target file -> the sink it ends at, or "" for a file target
  const goal = new Map<number, string>();
  if (to === undefined || isSink(to)) {
    const sinks = to ? [to] : [...ix.sinks.keys()].sort((x, y) => sinkRank(x) - sinkRank(y) || x.localeCompare(y));
    for (const s of sinks) for (const f of [...(ix.sinks.get(s)?.keys() ?? [])].sort((a, b) => a - b)) if (!goal.has(f)) goal.set(f, s);
  } else for (const f of filesUnder(ix, to)) goal.set(f, "");
  if (!sources.length || !goal.size) return [];
  const withSink = to === undefined || isSink(to);
  // hops to the nearest target, walking edges backwards: prunes every path that can't arrive in time
  const dist = new Map<number, number>([...goal.keys()].map((f) => [f, 0]));
  let ring = [...goal.keys()];
  for (let d = 1; d <= maxLen && ring.length; d++) {
    const next: number[] = [];
    for (const f of ring) for (const p of ix.into.get(f) ?? []) if (!dist.has(p)) { dist.set(p, d); next.push(p); }
    ring = next;
  }
  const found: number[][] = [];
  let work = 0;
  const walk = (path: number[]) => {
    if (++work > BUDGET) return;
    const at = path[path.length - 1];
    if (path.length > 1 && goal.has(at)) { found.push(path); return; }
    const left = maxLen - (path.length - 1);
    const next = (ix.out.get(at) ?? []).filter((n) => (dist.get(n) ?? Infinity) < left && !path.includes(n));
    for (const n of next.sort((x, y) => dist.get(x)! - dist.get(y)! || x - y)) walk([...path, n]);
  };
  for (const s of sources) {
    // a chain never starts inside the target; with a sink target, a source that uses it is a one-hop chain
    if (goal.has(s) && !withSink) continue;
    if (goal.has(s)) found.push([s]);
    else walk([s]);
  }
  const parts = (p: number[]) => new Set(p.map((f) => leafOf(ix, f))).size;
  // a router or barrel (lazyRoutes.ts imports every page) joins everything to everything: a detour
  const fan = (p: number[]) => Math.max(0, ...p.slice(1, -1).map((f) => ix.out.get(f)?.length ?? 0));
  const key = (p: number[]) => p.map((f) => g.paths[f]).join("\0");
  found.sort((x, y) => x.length - y.length || fan(x) - fan(y) || parts(y) - parts(x) || (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
  return found.slice(0, max).map((p) => {
    const paths = p.map((f) => g.paths[f]);
    const s = goal.get(p[p.length - 1]);
    return withSink && s ? [...paths, s] : paths;
  });
}

// a store is where data ends up; a service (an SDK) is a step out of the code
const sinkRank = (id: string) => (id.startsWith("store-") ? 0 : 1);
const leafOf = (ix: Index, f: number) => { const c = ix.chain.get(f)!; return c[c.length - 1]; };
