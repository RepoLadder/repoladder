// Flows: short chains of drawn arrows on one board ("KioskPage → kioskHttp → Cloud backend") that
// the viewer can play one at a time, so a busy board can be read a path at a time. Unlike tours,
// a flow never leaves its board, and it only follows arrows the board draws: edges are never invented.
import type { Facts, Grouping } from "./schema.ts";
import type { Board, Model, ModelEdge } from "./rollup.ts";
import { FILE, MORE, filePath } from "./fileboards.ts";
import { boxStem } from "./filenames.ts";

export interface ModelFlow {
  title: string;
  /** Box ids on the board, in order; each consecutive pair is a drawn edge. */
  path: string[];
  /** One line per edge, when the grouping named the flow. */
  captions?: string[];
  /** Declared in the grouping rather than derived. */
  named?: true;
}

export const MAX_FLOWS = 5;
const MAX_EDGES = 5;
/** Below this many multi-step flows, a board also gets single arrows into a sink. */
const MIN_FLOWS = 3;
const MAX_PATHS = 20000;

export interface FlowRoles {
  /** A page, route or endpoint: where a flow may start even when something points into it. */
  entry: (id: string) => boolean;
  /** A service, store or elsewhere box: where a flow ends. */
  sink: (id: string) => boolean;
  name: (id: string) => string;
}

const isRuntime = (e: ModelEdge) => e.calls > 0 || e.uses > 0;

/**
 * Up to MAX_FLOWS flows for one board, deterministically. Candidates are the maximal chains of
 * drawn edges from an entry (nothing points into it on the board, or a page/route/endpoint) to a
 * sink or a dead end (at most MAX_EDGES long). They are picked greedily: chains of two or more
 * edges first, then ones that end at a sink, then ones between a new pair of ends, then the most
 * new call and data edges, the most new edges, the longest; a chain whose arrows are mostly shown
 * by flows already picked is skipped. Single arrows only fill boards with fewer than MIN_FLOWS. `taken` holds paths
 * already used (named flows), whose edges count as shown.
 */
export function deriveFlows(board: Board, roles: FlowRoles, taken: string[][] = [], max = MAX_FLOWS): ModelFlow[] {
  const on = new Set(board.nodes.filter((id) => id !== MORE));
  const edges = board.edges.filter((e) => e.major && on.has(e.a) && on.has(e.b)).sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const out = new Map<string, ModelEdge[]>(), into = new Set<string>();
  for (const e of edges) { out.set(e.a, [...(out.get(e.a) ?? []), e]); into.add(e.b); }
  const starts = [...on].sort().filter((id) => out.has(id) && (!into.has(id) || roles.entry(id)));

  const paths: string[][] = [];
  const walk = (p: string[]) => {
    if (paths.length >= MAX_PATHS) return;
    const last = p[p.length - 1];
    const next = p.length > 1 && roles.sink(last) ? [] : (out.get(last) ?? []).filter((e) => !p.includes(e.b));
    if (!next.length || p.length > MAX_EDGES) { if (p.length > 1) paths.push(p); return; }
    for (const e of next) walk([...p, e.b]);
  };
  for (const s of starts) walk([s]);

  const byKey = new Map(edges.map((e) => [`${e.a}>${e.b}`, e]));
  const pairs = (p: string[]) => p.slice(1).map((b, i) => `${p[i]}>${b}`);
  const ends = (p: string[]) => `${p[0]}>${p[p.length - 1]}`;
  const shown = new Set(taken.flatMap(pairs)), endsShown = new Set(taken.map(ends));
  const picked: ModelFlow[] = [];
  const score = (p: string[]) => {
    const ks = pairs(p), fresh = ks.filter((k) => !shown.has(k));
    const rt = (xs: string[]) => xs.filter((k) => isRuntime(byKey.get(k)!)).length;
    // at least half of a chain must be arrows no picked flow shows yet
    const novel = fresh.length * 2 >= ks.length ? 1 : 0;
    return [novel, p.length > 2 ? 1 : 0, roles.sink(p[p.length - 1]) ? 1 : 0, endsShown.has(ends(p)) ? 0 : 1, rt(fresh), fresh.length, rt(ks), ks.length];
  };
  const title = (p: string[]) => `${roles.name(p[0])} → ${roles.name(p[p.length - 1])}`;
  let pool = paths;
  while (picked.length < max && pool.length) {
    const scored = pool.map((p) => ({ p, s: score(p), k: p.join("\n") })).filter((x) => x.s[0] > 0);
    if (!scored.length) break;
    scored.sort((x, y) => x.s.reduce((d, v, i) => d || y.s[i] - v, 0) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    // a flow between the same two boxes as one picked must pass through a box that one doesn't, to be told apart
    const best = scored.find((x) => {
      const same = picked.filter((f) => f.title === title(x.p));
      return !same.length || x.p.slice(1, -1).some((id) => same.every((f) => !f.path.includes(id)));
    })?.p;
    if (!best) break;
    // single arrows only fill a board that has too few longer chains
    if (best.length === 2 && picked.length + taken.length >= MIN_FLOWS) break;
    picked.push({ title: title(best), path: best });
    pairs(best).forEach((k) => shown.add(k));
    endsShown.add(ends(best));
    pool = scored.filter((x) => x.p !== best).map((x) => x.p);
  }
  // flows between the same two boxes are told apart by the first box only that one passes through
  const titles = picked.map((f) => f.title);
  picked.forEach((f, i) => {
    const same = picked.filter((_, j) => j !== i && titles[j] === titles[i]);
    const via = same.length ? f.path.slice(1, -1).find((id) => same.every((g) => !g.path.includes(id))) : undefined;
    if (via) f.title += ` via ${roles.name(via)}`;
  });
  return picked;
}

/**
 * The roles of a model's boxes, from the facts: pages, route files and endpoint files are entries.
 * A file is named by its route or endpoint when it has one ("/dashboard page", "/api/posts"), since
 * stems like page, route and layout say nothing; otherwise by its stem.
 */
export function modelRoles(model: Model, facts: Facts, boardId: string): FlowRoles {
  const b = model.boards[boardId];
  const entryFiles = new Set([...facts.pages.map((p) => p.file), ...facts.routeFiles.map((r) => r.file), ...facts.endpoints.map((e) => e.file)]);
  const only = <T>(xs: T[]) => (new Set(xs).size === 1 ? xs[0] : undefined);
  const fileName = (f: string) => {
    const page = only(facts.pages.filter((p) => p.file === f).map((p) => p.route));
    if (page) return `${page} page`;
    const ep = only(facts.endpoints.filter((e) => e.file === f && e.kind === "http").map((e) => e.name));
    if (ep) return ep;
    // a middleware's route is its matchers, too long for a title
    const rf = only(facts.routeFiles.filter((r) => r.file === f && r.role !== "middleware").map((r) => `${r.route === "/" ? "root" : r.route} ${r.role}`));
    return rf ?? boxStem(model.names, f);
  };
  return {
    entry: (id) => (id.startsWith(FILE) ? entryFiles.has(filePath(id)) : !!(model.nodes[id]?.pages?.length || model.nodes[id]?.endpoints?.length)),
    sink: (id) => !!model.services[id] || b.context.includes(id),
    name: (id) => (id.startsWith(FILE) ? fileName(filePath(id)) : model.services[id] ?? model.nodes[id]?.name ?? id),
  };
}

/**
 * Named flows from the grouping, validated like tours (every step a drawn arrow on that board),
 * then derived flows on every board to fill up to MAX_FLOWS. Boards without any are left out.
 */
export function resolveFlows(grouping: Grouping, model: Model, facts: Facts): { flows: Record<string, ModelFlow[]>; errors: string[] } {
  const errors: string[] = [];
  const named = new Map<string, ModelFlow[]>();
  const boardIds = Object.keys(model.boards).sort();
  (grouping.flows ?? []).forEach((f, fi) => {
    const at = `flows[${fi}] "${f.title}"`;
    const b = model.boards[f.board];
    if (!b) { errors.push(`${at}: board "${f.board}" is not a board (boards: ${boardIds.join(", ")})`); return; }
    const ids = f.path.map((x) => (b.nodes.includes(x) ? x : b.nodes.includes(FILE + x) ? FILE + x : null));
    const missing = f.path.filter((_, i) => !ids[i]);
    if (missing.length) { errors.push(`${at}: ${missing.map((x) => `"${x}"`).join(", ")} ${missing.length > 1 ? "are" : "is"} not drawn on board "${f.board}"`); return; }
    const path = ids as string[];
    let ok = true;
    for (let i = 1; i < path.length; i++) {
      const [a, z] = [path[i - 1], path[i]];
      const e = b.edges.find((x) => x.a === a && x.b === z);
      if (e?.major) continue;
      ok = false;
      const rev = b.edges.some((x) => x.a === z && x.b === a);
      errors.push(`${at} step ${i}: ${e ? `the edge ${f.path[i - 1]} -> ${f.path[i]} is not drawn on board "${f.board}" (only listed)` : `there is no edge ${f.path[i - 1]} -> ${f.path[i]} on board "${f.board}"${rev ? " (there is one the other way round; edges point from the code that imports or calls)" : ""}`}`);
    }
    if (f.captions && f.captions.length !== path.length - 1) { ok = false; errors.push(`${at}: ${f.captions.length} captions for ${path.length - 1} steps; give one per arrow`); }
    if (!ok) return;
    const list = named.get(f.board) ?? [];
    if (list.length >= MAX_FLOWS) { errors.push(`${at}: board "${f.board}" already has ${MAX_FLOWS} named flows`); return; }
    list.push({ title: f.title, path, ...(f.captions ? { captions: f.captions } : {}), named: true });
    named.set(f.board, list);
  });
  const flows: Record<string, ModelFlow[]> = {};
  for (const id of boardIds) {
    const mine = named.get(id) ?? [];
    const all = [...mine, ...deriveFlows(model.boards[id], modelRoles(model, facts, id), mine.map((f) => f.path), MAX_FLOWS - mine.length)];
    if (all.length) flows[id] = all;
  }
  return { flows, errors };
}
