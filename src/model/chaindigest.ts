// The digest's "Runtime chains" section: real file chains from where things start to code that
// touches a service or store, for Claude to copy into chain tours (docs/tours-v2.md). Shortest
// paths by BFS from each entry, so it stays linear in the graph even on big repos.
import { bareBarrels, fileGraph } from "./fgraph.ts";
import { mergedServices, storeId, svcId } from "./rollup.ts";
import type { Facts } from "./schema.ts";

const APP_ENTRY = /(^|\/)src\/(main|index|App)\.[jt]sx?$/;
const MAX_HOPS = 6;

// A type-only import runs nothing, so no chain or next hop goes along one.
const runtimeGraph = (facts: Facts) => {
  const bare = bareBarrels(facts); // an entry barrel's re-exports are edges, but no chain walks them
  return fileGraph({ imports: facts.imports.filter((i) => i.kind !== "type" && !bare.has(i.from)), calls: facts.calls }, new Map(facts.files.map((f) => [f.path, f.path])));
};

export interface DigestChain { files: string[]; calls: boolean[]; sink: string }

/** Entry files: page components, endpoint files and web app entries; else files nothing imports. */
export function entryFiles(facts: Facts): string[] {
  const web = new Set(facts.packages.filter((p) => p.kind === "web").map((p) => p.id));
  const set = new Set([...facts.pages.map((p) => p.file), ...facts.endpoints.map((e) => e.file), ...facts.files.filter((f) => web.has(f.pkg) && APP_ENTRY.test(f.path)).map((f) => f.path)]);
  if (!set.size) {
    const imported = new Set([...facts.imports.map((i) => i.to), ...facts.calls.map((c) => c.to)]);
    for (const i of facts.imports) if (!imported.has(i.from)) set.add(i.from);
  }
  return [...set].sort();
}

/**
 * The best chain per entry, top `n`. A chain never passes through another entry by import (a router
 * importing every page is not a flow), and it ranks: crosses a runtime call, reaches a service or
 * store, goes on past the call, gets to the call quickly, then length up to 5 files.
 */
export function topChains(facts: Facts, n: number): DigestChain[] {
  const out = new Map<string, { to: string; call: boolean }[]>();
  for (const e of runtimeGraph(facts)) out.set(e[0], [...(out.get(e[0]) ?? []), { to: e[1], call: e[3] > 0 && e[2] === 0 }]);
  const sinks = new Map<string, Set<string>>();
  const add = (f: string, what: string) => sinks.set(f, (sinks.get(f) ?? new Set()).add(what));
  // by the ids a chain may end with (a service merged into its store is the store)
  const merged = mergedServices(facts);
  for (const u of facts.serviceUses) add(u.from, merged.has(u.service) ? storeId(merged.get(u.service)!) : svcId(u.service));
  for (const u of facts.storeUses ?? []) add(u.file, `${storeId(u.store)}: ${u.collection} (${u.op === "read" ? "r" : "w"})`);

  const best: (DigestChain & { score: number })[] = [];
  const entries = entryFiles(facts), isEntry = new Set(entries);
  for (const entry of entries) {
    const prev = new Map<string, { from: string; call: boolean }>([[entry, { from: "", call: false }]]);
    let layer = [entry], far = entry;
    for (let d = 0; d < MAX_HOPS && layer.length; d++) {
      const next: string[] = [];
      for (const f of layer) {
        if (f !== entry && isEntry.has(f) && !prev.get(f)!.call) continue;
        for (const e of out.get(f) ?? []) if (!prev.has(e.to)) { prev.set(e.to, { from: f, call: e.call }); next.push(e.to); }
      }
      if (next.length) far = next.sort()[0];
      layer = next;
    }
    let top: (DigestChain & { score: number }) | undefined;
    const ends = [...prev.keys()].filter((f) => f !== entry && sinks.has(f));
    for (const end of ends.length || sinks.size ? ends : far !== entry ? [far] : []) {
      const files = [end], calls: boolean[] = [];
      for (let f = end; f !== entry; f = prev.get(f)!.from) { calls.unshift(prev.get(f)!.call); files.unshift(prev.get(f)!.from); }
      const what = [...(sinks.get(end) ?? [])].sort();
      const sink = what.filter((w) => !what.some((x) => x.startsWith(`${w}: `))).slice(0, 3).join(", ");
      const at = calls.indexOf(true), after = at < 0 ? 0 : calls.length - at - 1;
      const score = (at >= 0 ? 100 : 0) + (sink ? 50 : 0) + 10 * Math.min(after, 3) - 15 * Math.max(0, at - 1) + 5 * Math.min(files.length, 5);
      if (!top || score > top.score || (score === top.score && files.join() < top.files.join())) top = { files, calls, sink, score };
    }
    if (top) best.push(top);
  }
  // one chain per last hop, so a shared tail (every page reaching the same store helper through the
  // same API file) shows once, while distinct flows into a shared client (auth.service → prisma and
  // profile.service → prisma) each keep theirs
  const seen = new Set<string>();
  const tail = (c: DigestChain) => c.files.slice(-2).join("\0");
  return best.sort((a, b) => b.score - a.score || a.files.join().localeCompare(b.files.join()))
    .filter((c) => !seen.has(tail(c)) && !!seen.add(tail(c)))
    .slice(0, n).map(({ score: _, ...c }) => c);
}

/**
 * The digest lines: entry files, then the chains as `a → b ⇒ c` (⇒ is a runtime call by name or
 * URL), then what the entry and chain files import or call, up to `hops` files, so a tour can take
 * a path the chains don't show without guessing a hop.
 */
export function chainSection(facts: Facts, entries: number, chains: number, hops = entries): string[] {
  const files = entryFiles(facts), top = topChains(facts, chains);
  if (!top.length) return [];
  const cap = (xs: string[], k: number) => xs.slice(0, k).join(", ") + (xs.length > k ? ` … +${xs.length - k}` : "");
  return [
    "## Runtime chains (for tours' `chain`)",
    `Entry files (pages, endpoint files, app entries): ${cap(files, entries)}`,
    "Real chains from an entry to code that uses a service or store [its ids, which may end a chain] (with none in the repo, as deep as its imports go; → import, ⇒ runtime call by name/URL); shortest per entry, one per last hop, best first:",
    ...top.map((c) => `- ${c.files.map((f, i) => (i ? `${c.calls[i - 1] ? " ⇒ " : " → "}${f}` : f)).join("")}${c.sink ? `  [${c.sink}]` : ""}`),
    ...hopLines(facts, files, top, hops),
    "",
  ];
}

/**
 * `file → a, b, ⇒ c`: real next hops from the chains' files and the entries, then onward from
 * there while there is room. A target in the same folder as its file is shown by name, to save tokens.
 */
function hopLines(facts: Facts, entries: string[], top: DigestChain[], max: number): string[] {
  if (max <= 0) return [];
  const next = new Map<string, { to: string; call: boolean }[]>();
  for (const e of runtimeGraph(facts)) next.set(e[0], [...(next.get(e[0]) ?? []), { to: e[1], call: e[3] > 0 && e[2] === 0 }]);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (f: string) => { if (!seen.has(f) && next.has(f)) { seen.add(f); order.push(f); } };
  for (const c of top) c.files.forEach(visit);
  entries.forEach(visit);
  for (let i = 0; i < order.length && order.length < max; i++) for (const t of next.get(order[i])!) visit(t.to);
  if (!order.length) return [];
  const dir = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
  const PER = 8;
  const line = (f: string) => {
    const ts = next.get(f)!.map((t) => `${t.call ? "⇒ " : ""}${dir(t.to) === dir(f) ? t.to.slice(dir(f).length) : t.to}`);
    return `  ${f} → ${ts.slice(0, PER).join(", ")}${ts.length > PER ? ` … +${ts.length - PER}` : ""}`;
  };
  return [
    "Next hops, for chains the lines above don't show (→ imports, ⇒ calls; a bare file name is in the same folder as the file before the arrow):",
    ...order.slice(0, max).map(line),
    ...(order.length > max ? ["  … more in facts.json (`imports`, `calls`)"] : []),
  ];
}
