// Derived tours (docs/tours-v2.md, #197): with no AI, so `build --default` gets tours too. Entry
// files (pages, endpoints; else files nothing imports; with none of those giving a tour, a library's entry module, its re-exported
// public modules and its example apps) are followed along the file graph to a sink
// file, one that reads or writes a store or uses a service, by findChains, and composeTour turns each
// chain into multi-depth steps, the last lighting the arrow into the store or service. A chain
// composeTour can't draw (a hop on no board) is dropped: nothing is invented.
import { bareBarrels, passesThrough } from "./fgraph.ts";
import type { Facts } from "./schema.ts";
import type { Model } from "./rollup.ts";
import { mergedServices, storeId, svcId } from "./rollup.ts";
import { FILE, baseName } from "./fileboards.ts";
import { boxStem } from "./filenames.ts";
import type { ModelTour } from "./tours.ts";
import { composeTour, findChains, type Tour, type TourStep } from "./compose.ts";
import { slug, tourGraph } from "./chaintours.ts";

export const MAX_DERIVED = 4;
const MAX_LEN = 6;
const TARGETS_PER_ENTRY = 24;
const HUB_OUT = 12;
const MAX_ROOTS = 6;
/** Without a sink, the walk length that reads best (files): long enough to cross parts, short enough to follow. */
const WALK_FILES = 5;

const short = (p: string) => baseName(p).replace(/\.[^.]+$/, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
/** Whether a file is named like an endpoint: "checkIn" ~ checkin.ts, "listForms" ~ forms.ts. */
const namedLike = (endpoint: string, file: string) => { const f = norm(short(file)); return f.length >= 4 && (norm(endpoint).includes(f) || words(endpoint).some((w) => f.includes(w))); };

/** "Forms, Accounts and 3 more" */
const few = (xs: Set<string>) => { const l = [...xs].sort(); return l.length > 2 ? `${l.slice(0, 2).join(", ")} and ${l.length - 2} more` : l.join(" and "); };

interface Sink { box: string; rank: number; text: string }

/** Per file, the store or service it reaches directly, and how strongly it counts as the end of a flow. */
function sinksOf(model: Model, facts: Facts): Map<string, Sink> {
  const merged = mergedServices(facts), sinks = new Map<string, Sink>();
  const put = (file: string, s: Sink) => { const o = sinks.get(file); if (!o || s.rank > o.rank) sinks.set(file, s); };
  const ops = new Map<string, { box: string; reads: Set<string>; writes: Set<string> }>();
  for (const u of facts.storeUses) {
    const box = storeId(u.store);
    if (!model.services[box]) continue;
    const k = `${u.file}\0${box}`;
    const o = ops.get(k) ?? { box, reads: new Set(), writes: new Set() };
    (u.op === "write" ? o.writes : o.reads).add(u.collection);
    ops.set(k, o);
  }
  for (const k of [...ops.keys()].sort()) {
    const o = ops.get(k)!, file = k.slice(0, k.indexOf("\0")), store = model.services[o.box];
    const what = o.writes.size ? `writes ${few(o.writes)}` : `reads ${few(o.reads)}`;
    put(file, { box: o.box, rank: o.writes.size ? 3 : 2, text: `${boxStem(model.names, file)} ${what} in ${store}` });
  }
  for (const u of facts.serviceUses) {
    const into = merged.get(u.service);
    const box = into ? storeId(into) : svcId(u.service);
    if (!model.services[box]) continue;
    // a driver import of a store (the Firestore client) is a weaker end than its reads and writes
    put(u.from, { box, rank: into ? 1 : 2, text: `${boxStem(model.names, u.from)} uses ${model.services[box]}` });
  }
  return sinks;
}

/**
 * Up to MAX_DERIVED tours, fewer by one per `taken` tour (the grouping's own tours come first in the
 * list, and derived ones only fill it up), deterministically: the most distinct chains from an entry
 * to a sink, crossing the most parts: runtime calls first, then pages, the sink, the parts crossed,
 * the shortest. A chain with less than half of its steps new (not shown by a tour already picked, nor
 * by the grouping's `taken` tours) is skipped, and so is one starting inside a tour already picked or
 * one whose title another tour already has (from the same place to the same end: a near-duplicate).
 * `lib` is internal: the fallback pass, run once when a repo with no pages or endpoints got no tour,
 * from a library's entry module, its public modules and its example apps (two-file chains allowed).
 */
export function deriveTours(model: Model, facts: Facts, taken: ModelTour[] = [], lib = false): Tour[] {
  const max = MAX_DERIVED - taken.length;
  if (!model.fgraph?.length || max <= 0) return [];
  const g = tourGraph(model);
  const sinks = sinksOf(model, facts);
  const leafOf = new Map<string, string>();
  for (const [id, n] of Object.entries(model.nodes)) for (const f of n.files) leafOf.set(f, id);
  const top = (f: string) => { let id = leafOf.get(f)!; while (model.nodes[id].parent && model.nodes[id].parent !== "root") id = model.nodes[id].parent!; return id; };
  const calls = new Set(model.fgraph.filter((e) => e[3] > 0).map((e) => `${e[0]}>${e[1]}`));
  // endpoint names per call hop, and per endpoint file
  const called = new Map<string, string[]>(), defined = new Map<string, string[]>();
  for (const c of facts.calls) { const k = `${c.from}>${c.to}`, l = called.get(k) ?? []; if (!l.includes(c.endpoint)) called.set(k, [...l, c.endpoint]); }
  const kinds = new Map<string, string>();
  for (const e of facts.endpoints) { defined.set(e.file, [...(defined.get(e.file) ?? []), e.name]); kinds.set(`${e.file}\0${e.name}`, e.kind); }

  const out = new Map<string, string[]>();
  const bare = bareBarrels(facts), walked = model.fgraph.filter((e) => !bare.has(e[0]) || e[3] > 0);
  for (const e of walked) out.set(e[0], [...(out.get(e[0]) ?? []), e[1]]);
  // entries: pages and endpoint files; without either, the files nothing imports (a CLI, a server)
  // A page declared inline in its router is not an entry: its file is the whole app's.
  // A router declares several pages or another file's; a file-convention page (Next.js, React
  // Router) declares just itself, and is an entry like any other page.
  const declared = new Map<string, number>();
  for (const p of facts.pages) declared.set(p.from, (declared.get(p.from) ?? 0) + 1);
  const routers = new Set(facts.pages.filter((p) => p.file !== p.from || declared.get(p.from)! > 1).map((p) => p.from));
  const pageOf = new Map(facts.pages.filter((p) => !routers.has(p.file)).map((p) => [p.file, p.route]));
  const into = new Set(walked.map((e) => e[1]));
  const named = [...new Set([...pageOf.keys(), ...facts.endpoints.map((e) => e.file)])].filter((f) => out.has(f) && leafOf.has(f)).sort();
  const entries = lib ? libraryEntries(facts, out, into) : named.length ? named : rootEntries([...out.keys()].filter((f) => !into.has(f)), out);

  // The file graph can't tell which of an endpoint file's imports an endpoint runs. After a call
  // into one (or from one as the entry), when some import is named like the endpoint called
  // ("checkIn" -> checkin.ts), the chain must go there rather than into a sibling endpoint's code.
  const onward = (names: string[], f: string) => (out.get(f) ?? []).filter((n) => names.some((e) => namedLike(e, n)));
  // a type-only import runs nothing, so a flow can't pass along it
  const runs = new Set([...facts.imports.filter((i) => i.kind !== "type" && !passesThrough(i) && !bare.has(i.from)).map((i) => `${i.from}>${i.to}`), ...called.keys()]);
  const coherent = (chain: string[]) => chain.slice(1).every((b, i) => runs.has(`${chain[i]}>${b}`)) && chain.slice(0, -1).every((f, i) => {
    const names = i === 0 ? defined.get(f) ?? [] : called.get(`${chain[i - 1]}>${f}`) ?? [];
    const ok = onward(names, f);
    return !ok.length || ok.includes(chain[i + 1]);
  });
  // A chain never passes through a page or a router (it would wander into another screen), nor
  // through a file that imports more than HUB_OUT others (a barrel or shell, not a step of a flow).
  const passable = (f: string) => !pageOf.has(f) && !routers.has(f) && (out.get(f)?.length ?? 0) <= HUB_OUT;
  const cands: { chain: string[]; sink: Sink | null }[] = [];
  for (const s of entries) {
    // reachable files, nearest first (breadth-first over the file graph, through passable files)
    const dist = new Map([[s, 0]]), q = [s];
    for (let i = 0; i < q.length; i++) {
      if (i > 0 && (!passable(q[i]) || sinks.has(q[i]))) continue;
      for (const n of out.get(q[i]) ?? []) if (!dist.has(n) && dist.get(q[i])! < MAX_LEN) { dist.set(n, dist.get(q[i])! + 1); q.push(n); }
    }
    let targets = q.filter((f) => f !== s && sinks.has(f));
    const withSink = targets.length > 0;
    // no store or service in reach: walk to the farthest dead ends instead
    if (!withSink) targets = q.filter((f) => f !== s && !out.has(f)).sort((x, y) => dist.get(y)! - dist.get(x)! || x.localeCompare(y));
    for (const t of targets.slice(0, TARGETS_PER_ENTRY))
      // near-shortest chains only: one hop longer than the shortest at most
      for (const chain of findChains(g, s, t, { max: 4, maxLen: dist.get(t)! + 1 })) {
        const inner = chain.slice(1, -1);
        // stop at the first sink: a chain that passes through one would end there
        if ((withSink || chain.length > 2 || lib) && inner.every((f) => passable(f) && !sinks.has(f)) && coherent(chain)) cands.push({ chain, sink: withSink ? sinks.get(t)! : null });
      }
  }

  // compose, with the arrow into the sink when it is drawn; a chain composeTour can't draw is dropped
  const built: { chain: string[]; steps: TourStep[]; score: number[]; sinkBox: string | null }[] = [];
  const compose = (chain: string[]) => { try { return composeTour(g, chain); } catch { return null; } };
  for (const c of cands) {
    let steps = (c.sink && compose([...c.chain, c.sink.box])) || compose(c.chain);
    if (!steps) continue;
    // back to model ids: file boxes are "f:<path>" in the model, "@<index>" only in page data
    const mid = (x: string) => (x.startsWith("@") ? FILE + g.paths[Number(x.slice(1))] : x);
    steps = steps.map((s) => ({ ...s, lit: { boxes: s.lit.boxes.map(mid), edges: s.lit.edges.map(([a, b]) => [mid(a), mid(b)] as [string, string]) } }));
    const sink = c.sink && steps[steps.length - 1].via?.[1] === c.sink.box ? c.sink : null;
    steps.forEach((s) => { if (s.via) s.caption = sink && s.via[1] === sink.box ? sink.text : caption(model, s, called); });
    const hops = c.chain.slice(1).map((b, i) => `${c.chain[i]}>${b}`);
    const parts = new Set(c.chain.map(top)).size, leaves = new Set(c.chain.map((f) => leafOf.get(f))).size;
    const boards = new Set(steps.map((s) => s.board)).size;
    built.push({ chain: c.chain, steps, sinkBox: sink?.box ?? null, score: [hops.some((h) => calls.has(h)) ? 1 : 0, pageOf.has(c.chain[0]) ? 1 : 0, named.length ? 0 : -entries.indexOf(c.chain[0]), sink?.rank ?? 0, parts, sink ? -c.chain.length : -Math.abs(c.chain.length - WALK_FILES), boards, leaves] });
  }

  const key = (s: { board: string; lit: { edges: [string, string][] } }) => s.lit.edges.map(([a, b]) => `${s.board}|${a}>${b}`);
  const shown = new Set(taken.flatMap((t) => t.steps.flatMap((s) => (s.lit?.edges ?? (s.edge ? [s.edge] : [])).map(([a, b]) => `${s.board}|${a}>${b}`)))), usedEntries = new Set<string>(), usedEnds = new Set<string>(), usedSinks = new Set<string>();
  // Titles name the entry by its route or endpoint, else by the box that holds it (a file's stem,
  // "route" or "index", says little), and the end by its store or service, else by its box.
  // a box named for no part of the app ("Other", "Files in src/", "convertToShape hub") gives way to its parent's name
  const boxName = (f: string, not?: string) => {
    for (let id = leafOf.get(f); id && id !== "root"; id = model.nodes[id].parent ?? undefined) {
      const name = model.nodes[id].name.replace(/^\((.+)\)$/, "$1");
      if (name !== not && !VAGUE.test(name)) return name[0].toUpperCase() + name.slice(1);
    }
    return GENERIC.test(short(f)) ? model.nodes[leafOf.get(f)!].name : short(f);
  };
  const endName = (b: (typeof built)[number]) => (b.sinkBox ? model.services[b.sinkBox] : boxName(b.chain[b.chain.length - 1]));
  const label = (c: string[], end: string) => {
    if (pageOf.has(c[0])) return `the ${pageOf.get(c[0])} page`;
    const eps = [...new Set(defined.get(c[0]) ?? [])], ep = eps.length === 1 ? eps : eps.filter((e) => namedLike(e, c[1]));
    if (ep.length === 1) {
      const kind = kinds.get(`${c[0]}\0${ep[0]}`);
      return kind === "action" ? `the ${ep[0].replace(/(.)Action$/, "$1")} action` : kind === "event" ? `the ${ep[0]} handler` : `the ${ep[0]} endpoint`;
    }
    return boxName(c[0], end);
  };
  const titleOf = (b: (typeof built)[number]) => { const end = endName(b), t = `From ${label(b.chain, end)} to ${end}`; return t[0].toUpperCase() + t.slice(1); };
  const titles = new Set<string>();
  const picked: (typeof built)[number][] = [];
  let pool = built;
  while (picked.length < max && pool.length) {
    const scored = pool.map((b) => {
      const ks = b.steps.flatMap(key), fresh = ks.filter((k) => !shown.has(k)).length;
      const end = `${b.chain[0]}>${b.sinkBox ?? b.chain[b.chain.length - 1]}`;
      return { b, s: [fresh * 2 >= ks.length ? 1 : 0, usedEntries.has(b.chain[0]) ? 0 : 1, usedEnds.has(end) ? 0 : 1, b.score[0], b.sinkBox && !usedSinks.has(b.sinkBox) ? 1 : 0, ...b.score.slice(1), fresh], k: b.chain.join("\n") };
    // a chain starting inside a tour already picked would only retell its end
    }).filter((x) => x.s[0] > 0 && !picked.some((q) => q.chain.includes(x.b.chain[0])) && !titles.has(titleOf(x.b)));
    if (!scored.length) break;
    scored.sort((x, y) => x.s.reduce((d, v, i) => d || y.s[i] - v, 0) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    const best = scored[0].b;
    picked.push(best);
    titles.add(titleOf(best));
    best.steps.flatMap(key).forEach((k) => shown.add(k));
    usedEntries.add(best.chain[0]);
    if (best.sinkBox) usedSinks.add(best.sinkBox);
    usedEnds.add(`${best.chain[0]}>${best.sinkBox ?? best.chain[best.chain.length - 1]}`);
    pool = scored.slice(1).map((x) => x.b);
  }

  const ids = new Set(taken.map((t) => t.id));
  const tours = picked.map((p): Tour => {
    const title = titleOf(p);
    let id = `derived-${slug(title)}`;
    for (let n = 2; ids.has(id); n++) id = `derived-${slug(title)}-${n}`;
    ids.add(id);
    return { id, title, steps: p.steps, source: "derived" };
  });
  if (!tours.length && !lib && !named.length) return deriveTours(model, facts, taken, true);
  return tours;
}

const VAGUE = /^(other|others|misc|more( .*)?|files in .*|.* (hub|core))$/i;
/** File stems that say nothing about what a file does: a framework's conventions and barrels. */
const GENERIC = /^(index|route|page|layout|actions?|main|server|app|handler|router|mod|utils?|helpers?|types?)$/;
const ENTRY_NAME = /^(cli|main|index|server|app|bin)$/;
const ASIDE = /(^|\/)(scripts?|spike|interview|examples?|fixtures?|tests?|__tests__|e2e|docs?|bench)\//;
/**
 * Without pages or endpoints, the files nothing imports, best first: not in a scripts/spike/test
 * folder, named like an entry (cli.ts, main.ts, server.ts), then reaching the most files.
 */
function rootEntries(roots: string[], out: Map<string, string[]>): string[] {
  const reach = (s: string) => { const seen = new Set([s]), q = [s]; for (let i = 0; i < q.length; i++) for (const n of out.get(q[i]) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); } return seen.size; };
  const key = (f: string) => [ASIDE.test(f) ? 1 : 0, ENTRY_NAME.test(short(f)) ? 0 : 1, -reach(f)];
  return roots.map((f) => ({ f, k: key(f) })).sort((x, y) => x.k.reduce((d, v, i) => d || v - y.k[i], 0) || x.f.localeCompare(y.f)).slice(0, MAX_ROOTS).map((x) => x.f);
}

/**
 * The fallback's entries, in order: each library package's entry module (`index` or `src/index`, the
 * convention the analyzer's workspace resolver falls back to) and the public modules it re-exports,
 * then files nothing imports under an examples folder (how a reader meets a library).
 */
function libraryEntries(facts: Facts, out: Map<string, string[]>, into: Set<string>): string[] {
  const files = new Set(facts.files.map((f) => f.path)), list: string[] = [];
  for (const p of facts.packages) {
    if (p.kind !== "library") continue;
    const dir = p.dir;
    const cand = ["index", "src/index"].flatMap((b) => ["ts", "tsx", "mts", "js", "jsx", "mjs"].map((x) => (dir ? `${dir}/${b}.${x}` : `${b}.${x}`)));
    const f = cand.find((c) => files.has(c));
    if (!f) continue;
    if (out.has(f)) list.push(f);
    list.push(...facts.imports.filter((i) => i.from === f && i.kind === "reexport" && out.has(i.to)).map((i) => i.to).sort());
  }
  list.push(...[...out.keys()].filter((f) => !into.has(f) && /(^|\/)examples?\//.test(f)).sort());
  return [...new Set(list)];
}

/** "kioskHttp calls checkIn in index (Web → Functions)": from the edge's kind and the names. */
function caption(model: Model, s: TourStep, called: Map<string, string[]>): string {
  const [a, b] = s.via!, eps = called.get(`${a}>${b}`);
  const what = eps ? `calls ${eps[0]}${eps.length > 1 ? ` (and ${eps.length - 1} more)` : ""} in ${boxStem(model.names, b)}` : `uses ${boxStem(model.names, b)}`;
  const [x, y] = s.lit.edges[0] ?? [];
  const grp = (id: string) => (id && !id.startsWith(FILE) ? model.nodes[id]?.name : undefined);
  const where = grp(x) && grp(y) ? ` (${grp(x)} → ${grp(y)})` : "";
  return `${boxStem(model.names, a)} ${what}${where}`;
}
