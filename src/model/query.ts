// `repoladder query`: structural lookups over facts.json. Pure (no I/O): every row carries file:line evidence,
// output is sorted so the same facts give the same answer, and the row count is bounded.
import { assign, defaultGrouping } from "./grouping.ts";
import type { Facts, Grouping, GroupNode } from "./schema.ts";

export const QUERY_KINDS = ["definitions", "importers", "callers", "touches", "files"] as const;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export type QueryErrorCode = "OLD_FACTS" | "UNKNOWN_QUERY" | "UNKNOWN_TARGET" | "INVALID_OPTIONS";

export class QueryError extends Error {
  code: QueryErrorCode;
  constructor(code: QueryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface QueryOptions {
  limit?: unknown;
  /** The grouping the `files` kind reads; the default grouping of the facts when absent. */
  grouping?: Grouping;
  /** Label for where the grouping came from, reported by `files`. */
  groupingSource?: "grouping.json" | "default";
}

type Row = { file: string; line: number } & Record<string, unknown>;

const allNodes = (ns: GroupNode[]): GroupNode[] => ns.flatMap((n) => [n, ...allNodes(n.children ?? [])]);
const cmp = (a: unknown, b: unknown) => (a === b ? 0 : String(a) < String(b) ? -1 : 1);
const sample = (xs: string[]) => [...new Set(xs)].sort().slice(0, 20).join(", ") || "none";

function sortRows(rows: Row[]): Row[] {
  return rows
    .map((r) => ({ r, k: JSON.stringify(r) }))
    .sort((a, b) => cmp(a.r.file, b.r.file) || a.r.line - b.r.line || cmp(a.k, b.k))
    .map((x) => x.r);
}

function checkLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new QueryError("INVALID_OPTIONS", `--limit needs a whole number from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

export function runQuery(facts: Facts, kind: string | undefined, arg: string | undefined, opts: QueryOptions = {}): string {
  const limit = checkLimit(opts.limit);
  if (!QUERY_KINDS.includes(kind as (typeof QUERY_KINDS)[number])) {
    throw new QueryError("UNKNOWN_QUERY", `unknown query ${JSON.stringify(kind ?? "")}; use one of: ${QUERY_KINDS.join(", ")}`);
  }
  if (arg === undefined || arg === "") throw new QueryError("UNKNOWN_TARGET", `${kind} needs an argument`);
  let rows: Row[];
  let extra: Record<string, unknown> = {};

  if (kind === "definitions") {
    const withExports = facts.files.filter((f) => f.exports?.length);
    if (withExports.length && !withExports.some((f) => f.exportLines)) {
      throw new QueryError("OLD_FACTS", "these facts predate export lines; re-run `repoladder analyze <repo>`");
    }
    rows = [];
    for (const f of withExports) {
      const i = f.exports!.indexOf(arg);
      if (i >= 0 && f.exportLines?.[i] !== undefined) rows.push({ file: f.path, line: f.exportLines[i], name: arg, kind: "export", pkg: f.pkg });
    }
    for (const e of facts.endpoints) if (e.name === arg) rows.push({ file: e.file, line: e.line, name: arg, kind: "endpoint", endpoint: e.kind });
  } else if (kind === "importers") {
    if (!facts.files.some((f) => f.path === arg)) throw new QueryError("UNKNOWN_TARGET", `no file ${JSON.stringify(arg)} in the facts; give a repo-relative path`);
    rows = facts.imports.filter((i) => i.to === arg).map((i) => ({ file: i.from, line: i.line, kind: i.kind, imports: i.to, ...(i.via ? { via: i.via } : {}) }));
  } else if (kind === "callers") {
    const known = [...new Set([...facts.endpoints.map((e) => e.name), ...facts.calls.map((c) => c.endpoint)])];
    if (!known.includes(arg) && !facts.calls.some((c) => c.to === arg)) throw new QueryError("UNKNOWN_TARGET", `no endpoint ${JSON.stringify(arg)}; known: ${sample(known)}`);
    rows = facts.calls.filter((c) => c.endpoint === arg || c.to === arg).map((c) => {
      const def = facts.endpoints.find((e) => e.file === c.to && e.name === c.endpoint);
      return { file: c.from, line: c.line, endpoint: c.endpoint, kind: c.kind, ...(def ? { defined: `${def.file}:${def.line}` } : {}) };
    });
  } else if (kind === "touches") {
    const dbServices = new Map(facts.services.map((s) => [s.id, s]));
    const stores = facts.stores ?? [];
    const want = arg.toLowerCase();
    const storeRows = (match: (id: string) => boolean): Row[] =>
      (facts.storeUses ?? []).filter((u) => match(u.store)).map((u) => ({ file: u.file, line: u.line, via: "store", target: u.store, collection: u.collection, op: u.op }));
    const serviceRows = (match: (id: string) => boolean): Row[] =>
      facts.serviceUses.filter((u) => match(u.service)).map((u) => ({ file: u.from, line: u.line, via: "service", target: dbServices.get(u.service)?.name ?? u.service, spec: u.spec }));
    if (want === "database") {
      rows = [...storeRows(() => true), ...serviceRows((id) => dbServices.get(id)?.category === "database")];
    } else {
      const ids = new Set([...facts.services, ...stores].filter((s) => s.id.toLowerCase() === want || s.name.toLowerCase() === want).map((s) => s.id));
      if (!ids.size) throw new QueryError("UNKNOWN_TARGET", `no service or store ${JSON.stringify(arg)}; known: database, ${sample([...facts.services, ...stores].map((s) => s.name))}`);
      const storeIds = new Set(stores.map((s) => s.id));
      rows = [...storeRows((id) => ids.has(id) && storeIds.has(id)), ...serviceRows((id) => ids.has(id))];
    }
  } else {
    const grouping = opts.grouping ?? defaultGrouping(facts);
    const node = allNodes(grouping.children).find((n) => n.id === arg);
    if (!node) throw new QueryError("UNKNOWN_TARGET", `no group ${JSON.stringify(arg)}; top-level groups: ${sample(grouping.children.map((n) => n.id))}`);
    const leaves = new Set(allNodes([node]).filter((n) => n.files).map((n) => n.id));
    const { leafOf } = assign(grouping, facts);
    const byPath = new Map(facts.files.map((f) => [f.path, f]));
    rows = [...leafOf].filter(([, leaf]) => leaves.has(leaf)).map(([path]) => ({ file: path, line: 1, loc: byPath.get(path)!.loc, pkg: byPath.get(path)!.pkg }));
    extra = { grouping: opts.groupingSource ?? (opts.grouping ? "grouping.json" : "default") };
  }

  const sorted = sortRows(rows);
  return JSON.stringify({ query: { kind, arg }, total: sorted.length, truncated: sorted.length > limit, ...extra, results: sorted.slice(0, limit) }) + "\n";
}
