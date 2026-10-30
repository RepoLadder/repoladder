// The file-level graph: every file-to-file connection the boards roll up, once per pair, so the
// viewer can roll up boards of its own (the detail dial) without the facts.
// It counts exactly what rollup.ts counts between two files (imports except re-exports, and
// runtime calls), and keeps the evidence rollup.ts would pick first for the pair: its first
// import, or, for a pair joined only by calls, its first call.
import type { Facts } from "./schema.ts";

// What React Router / Remix and Next.js call on a route module.
export const ROUTE_EXPORTS = new Set([
  "action", "loader", "clientAction", "clientLoader", "meta", "links", "headers", "handle", "ErrorBoundary", "HydrateFallback", "shouldRevalidate",
  "getServerSideProps", "getStaticProps", "getStaticPaths", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
]);


/**
 * A re-export only passes names through to the importers analyze routed past it, so it is no edge
 * of its own. Any other re-export is a connection (`runtime`: a route's `export { action }`, an
 * unimported barrel's, an imported barrel's unused export).
 */
export const passesThrough = (i: { kind: string; runtime?: true }) => i.kind === "reexport" && !i.runtime;

/**
 * Files whose imports are all re-exports and that are no page, endpoint or route file: barrels and
 * package entries. Their re-exports are edges (#450), but a derived tour or chain digest never
 * walks through one, so those stay as they were before the re-exports were drawn.
 */
export function bareBarrels(facts: Pick<Facts, "imports"> & Partial<Pick<Facts, "pages" | "endpoints" | "routeFiles" | "files">>): Set<string> {
  const keep = new Set([...(facts.pages ?? []).map((p) => p.file), ...(facts.routeFiles ?? []).map((r) => r.file), ...(facts.endpoints ?? []).map((e) => e.file)]);
  // a file exporting a route name is a route module the analyzer doesn't know: its re-exports are hops
  for (const x of facts.files ?? []) if (x.exports?.some((n) => ROUTE_EXPORTS.has(n))) keep.add(x.path);
  const other = new Set(facts.imports.filter((i) => i.kind !== "reexport").map((i) => i.from));
  return new Set(facts.imports.filter((i) => i.kind === "reexport" && !other.has(i.from) && !keep.has(i.from)).map((i) => i.from));
}

/**
 * [from, to, imports, calls, line, call?]: `line` is in `from`. `call` is set only when the
 * evidence is a call (no imports): the evidence target rollup.ts writes, "<endpoint> (<to>)".
 * The evidence is then [from, line, call ?? to], the same triple a board edge carries.
 */
export type FileEdge<F = string> = [from: F, to: F, imports: number, calls: number, line: number, call?: string];

/** Pairs between files that are on some board (`leafOf`), sorted by from, then to. */
export function fileGraph(facts: Pick<Facts, "imports" | "calls">, leafOf: Map<string, string>): FileEdge[] {
  const pairs = new Map<string, FileEdge>();
  const pair = (from: string, to: string, line: number, call?: string) => {
    if (from === to || !leafOf.has(from) || !leafOf.has(to)) return null;
    const k = `${from}\0${to}`;
    let e = pairs.get(k);
    if (!e) pairs.set(k, (e = call === undefined ? [from, to, 0, 0, line] : [from, to, 0, 0, line, call]));
    return e;
  };
  // facts are sorted by file and line, so the first one seen is the first in the file
  for (const i of facts.imports) if (!passesThrough(i)) { const e = pair(i.from, i.to, i.line); if (e) e[2]++; }
  for (const c of facts.calls) { const e = pair(c.from, c.to, c.line, `${c.endpoint} (${c.to})`); if (e) e[3]++; }
  return [...pairs.values()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
}
