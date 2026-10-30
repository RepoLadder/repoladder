// Which boards draw a connection (#449): every import, call and service or store use should be an
// arrow on at least one rung. Group boards declutter, so a minor connection may be listed only; the
// file rung (a leaf's file board) draws every connection of its files, which is the guarantee.
// This is the lookup that checks it, from the facts and a built model. Pure; no viewer imports.
import { passesThrough } from "./fgraph.ts";
import { FILE, MORE } from "./fileboards.ts";
import { boardEnds } from "./rollrules.ts";
import { mergedServices, storeId, svcId, type Model } from "./rollup.ts";
import type { Facts } from "./schema.ts";

export interface UndrawnConnection {
  from: string;
  /** The other file, or the service or store id for a use. */
  to: string;
  /** "hidden": both ends sit behind the same "+N more" box, so no arrow can join them. */
  reason: "hidden" | "minor";
}

export interface DrawnReport {
  /** `file>file` for an import or call, `file>serviceOrStoreId` for a use, to the boards that carry it as a major arrow. */
  rungs: Map<string, string[]>;
  /** Connections with their file end(s) in a leaf, each counted once. */
  connections: number;
  undrawn: number;
  /** Connections with an end in no leaf: nothing can draw them. */
  outsideLeaves: number;
  list: UndrawnConnection[];
}

type Ends = (from: string, to: string) => [string, string, boolean] | null;

/** Builds the lookup once for a model; `drawingRungs` builds it once per call. */
function index(model: Model) {
  const chains = new Map<string, string[]>();
  const leafOf = new Map<string, string>();
  const chainOfLeaf = (leaf: string) => {
    const c: string[] = [];
    for (let id: string | null = leaf; id && id !== "root"; id = model.nodes[id]?.parent ?? null) c.unshift(id);
    return c;
  };
  for (const n of Object.values(model.nodes)) {
    if (n.children.length || !n.files.length || n.id === "root") continue;
    const c = chainOfLeaf(n.id);
    for (const f of n.files) { chains.set(f, c); leafOf.set(f, n.id); }
  }
  const chainOf = (f: string) => chains.get(f);
  const major = new Map<string, Set<string>>();
  const majorOf = (board: string) => {
    let s = major.get(board);
    if (!s) {
      s = new Set();
      for (const e of model.boards[board]?.edges ?? []) if (e.major) s.add(`${e.a}>${e.b}`);
      major.set(board, s);
    }
    return s;
  };
  const endsCache = new Map<string, Ends>();
  const endsOf = (board: string): Ends => {
    let f = endsCache.get(board);
    if (!f) {
      const isLeaf = board !== "root" && (model.nodes[board]?.children.length ?? 1) === 0;
      const own = board === "root" ? [] : chainOfLeaf(board);
      if (isLeaf) {
        const shown = new Set(model.boards[board]?.nodes ?? []);
        const boxOf = (file: string): string | null => (leafOf.get(file) !== board ? null : shown.has(FILE + file) ? FILE + file : MORE);
        f = boardEnds(own, chainOf, boxOf).ends;
      } else f = boardEnds(own, chainOf).ends;
      endsCache.set(board, f);
    }
    return f;
  };
  /** The boards that may carry a connection between two files: their groups' boards, and their leaves' file boards. */
  const boardsFor = (...files: string[]) => {
    const ids = new Set<string>();
    for (const f of files) { const c = chains.get(f); if (c) { ids.add("root"); for (const id of c) ids.add(id); } }
    return [...ids].filter((id) => !!model.boards[id]);
  };
  return { leafOf, chains, majorOf, endsOf, boardsFor };
}

export function drawingRungs(facts: Facts, model: Model): DrawnReport {
  const ix = index(model);
  const merged = mergedServices(facts);
  const rungs = new Map<string, string[]>();
  const list: UndrawnConnection[] = [];
  let outsideLeaves = 0;
  const seen = new Set<string>();

  const pair = (from: string, to: string) => {
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!ix.leafOf.has(from) || !ix.leafOf.has(to)) { outsideLeaves++; return; }
    const on: string[] = [];
    for (const b of ix.boardsFor(from, to)) {
      const r = ix.endsOf(b)(from, to);
      if (r && ix.majorOf(b).has(`${r[0]}>${r[1]}`)) on.push(b);
    }
    rungs.set(key, on);
    if (!on.length) list.push({ from, to, reason: ix.leafOf.get(from) === ix.leafOf.get(to) && ix.endsOf(ix.leafOf.get(from)!)(from, to) === null ? "hidden" : "minor" });
  };
  const use = (from: string, target: string) => {
    const key = `${from}>${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!ix.leafOf.has(from)) { outsideLeaves++; return; }
    const on: string[] = [];
    for (const b of ix.boardsFor(from)) {
      const a = fromBox(b, from);
      if (a && ix.majorOf(b).has(`${a}>${target}`)) on.push(b);
    }
    rungs.set(key, on);
    if (!on.length) list.push({ from, to: target, reason: "minor" });
  };
  /** The box a file lands in on a board: its child there, or its own file box on its leaf's board. */
  const fromBox = (board: string, file: string): string | null => {
    const c = ix.chains.get(file);
    if (!c) return null;
    if (board === c[c.length - 1]) {
      const shown = model.boards[board]?.nodes.includes(FILE + file);
      return shown ? FILE + file : MORE;
    }
    if (board === "root") return c[0] ?? null;
    const i = c.indexOf(board);
    return i >= 0 ? c[i + 1] ?? null : null;
  };

  for (const i of facts.imports) if (!passesThrough(i) && i.from !== i.to) pair(i.from, i.to);
  for (const c of facts.calls) if (c.from !== c.to) pair(c.from, c.to);
  for (const u of facts.serviceUses) {
    const st = merged.get(u.service);
    use(u.from, st ? storeId(st) : svcId(u.service));
  }
  for (const u of facts.storeUses ?? []) use(u.file, storeId(u.store));

  return { rungs, connections: rungs.size, undrawn: list.length, outsideLeaves, list };
}

/** Whether a connection between two files (or a file and a service or store id) has an arrow on some board. */
export function isDrawn(facts: Facts, model: Model, from: string, to: string): boolean {
  // one pass per (facts, model): callers ask per hop
  let byModel = reports.get(facts);
  if (!byModel) reports.set(facts, (byModel = new WeakMap()));
  let r = byModel.get(model);
  if (!r) byModel.set(model, (r = drawingRungs(facts, model)));
  return (r.rungs.get(`${from}>${to}`)?.length ?? 0) > 0;
}
const reports = new WeakMap<Facts, WeakMap<Model, DrawnReport>>();
