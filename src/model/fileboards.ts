// File boards: opening a leaf group shows its files as boxes, with the real import and call edges
// between them, plus dashed context boxes for the other parts those files reach.
import { passesThrough } from "./fgraph.ts";
import type { Facts } from "./schema.ts";
import { FILE_EVIDENCE, finishFileBoard } from "./rollrules.ts";
import { DEFAULT_PROFILE, type Profile } from "./profile.ts";
import { mergedServices, storeId, svcId, type Board, type Evidence, type ModelEdge, type ModelNode } from "./rollup.ts";

/** A file box's id on a file board is its path behind this prefix. */
export const FILE = "f:";
/** The box that stands in for the files a big leaf doesn't draw. */
export const MORE = "+more";
/** Above this many files, a leaf shows its best-connected files and a "+N more" box. */
export const MAX_FILE_BOXES = 16;
const MAX_EXPORTS = 3;

export interface ModelFile { loc: number; exports: string[] }

export const isFileId = (id: string) => id.startsWith(FILE) || id === MORE;
export const filePath = (id: string) => id.slice(FILE.length);
export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);


/** One board per leaf group (keyed by the leaf's id), and the file details its boxes show. */
export function buildFileBoards(facts: Facts, nodes: Record<string, ModelNode>, leafOf: Map<string, string>, profile: Profile = DEFAULT_PROFILE): { boards: Record<string, Board>; files: Record<string, ModelFile> } {
  const ownCache = new Map<string, string[]>();
  const own = (leaf: string) => {
    let c = ownCache.get(leaf);
    if (!c) {
      c = [];
      for (let id: string | null = leaf; id && id !== "root"; id = nodes[id].parent) c.unshift(id);
      ownCache.set(leaf, c);
    }
    return c;
  };
  const info = new Map(facts.files.map((f) => [f.path, f]));
  // How connected each file is, to pick what a big leaf draws.
  const degree = new Map<string, number>();
  const bump = (f: string) => degree.set(f, (degree.get(f) ?? 0) + 1);
  for (const i of facts.imports) if (!passesThrough(i)) { bump(i.from); bump(i.to); }
  for (const c of facts.calls) { bump(c.from); bump(c.to); }
  for (const u of facts.serviceUses) bump(u.from);

  // The facts each leaf's board can draw, in the facts' own order: a fact only matters to the leaves of its
  // two ends (boxOf is null for any other leaf), so a leaf reads its own lists, not every fact.
  type Imp = Facts["imports"][number];
  type Call = Facts["calls"][number];
  const byLeaf = new Map<string, { imports: Imp[]; calls: Call[]; storeUses: NonNullable<Facts["storeUses"]>; serviceUses: Facts["serviceUses"] }>();
  const slot = (l: string) => { let x = byLeaf.get(l); if (!x) byLeaf.set(l, (x = { imports: [], calls: [], storeUses: [], serviceUses: [] })); return x; };
  const byEnds = <T extends { from: string; to: string }>(list: T[], into: (l: string) => T[]) => {
    for (const f of list) {
      const a = leafOf.get(f.from), b = leafOf.get(f.to);
      if (a) into(a).push(f);
      if (b && b !== a) into(b).push(f);
    }
  };
  byEnds(facts.imports.filter((i) => !passesThrough(i)), (l) => slot(l).imports);
  byEnds(facts.calls, (l) => slot(l).calls);
  for (const u of facts.storeUses ?? []) { const l = leafOf.get(u.file); if (l) slot(l).storeUses.push(u); }
  for (const u of facts.serviceUses) { const l = leafOf.get(u.from); if (l) slot(l).serviceUses.push(u); }
  const none = { imports: [], calls: [], storeUses: [], serviceUses: [] };

  const merged = mergedServices(facts);
  const boards: Record<string, Board> = {};
  const files: Record<string, ModelFile> = {};
  for (const leaf of Object.values(nodes)) {
    if (leaf.children.length || !leaf.files.length || leaf.id === "root") continue;
    const mine = own(leaf.id);
    const ranked = [...leaf.files].sort((x, y) => (degree.get(y) ?? 0) - (degree.get(x) ?? 0) || x.localeCompare(y));
    const shown = new Set(leaf.files.length > MAX_FILE_BOXES ? ranked.slice(0, MAX_FILE_BOXES - 1) : leaf.files);
    const boxOf = (f: string): string | null => (leafOf.get(f) !== leaf.id ? null : shown.has(f) ? FILE + f : MORE);
    // the part a file outside this leaf belongs to, at the level where its path splits from ours
    const contextOf = (f: string): string | null => {
      const l = leafOf.get(f);
      if (!l) return null;
      const c = own(l);
      for (let i = 0; i < mine.length; i++) if (c[i] !== mine[i]) return c[i] ?? null;
      return null;
    };

    const edges = new Map<string, ModelEdge>();
    const ctxEdges = new Set<ModelEdge>();
    const edge = (a: string, b: string) => {
      const k = `${a}>${b}`;
      let e = edges.get(k);
      if (!e) edges.set(k, (e = { a, b, imports: 0, calls: 0, uses: 0, major: false, ev: [] }));
      return e;
    };
    const note = (e: ModelEdge, ev: Evidence) => {
      if (e.ev.length < FILE_EVIDENCE && !e.ev.some((x) => x[0] === ev[0] && x[1] === ev[1])) e.ev.push(ev);
    };
    const ends = (from: string, to: string): [string, string, boolean] | null => {
      const a = boxOf(from), b = boxOf(to);
      if (a && b) return a === b ? null : [a, b, false];
      if (a) { const x = contextOf(to); return x ? [a, x, true] : null; }
      if (b) { const x = contextOf(from); return x ? [x, b, true] : null; }
      return null;
    };
    const mineFacts = byLeaf.get(leaf.id) ?? none;
    for (const imp of mineFacts.imports) {
      const r = ends(imp.from, imp.to);
      if (!r) continue;
      const e = edge(r[0], r[1]);
      if (r[2]) ctxEdges.add(e);
      e.imports++;
      note(e, [imp.from, imp.line, imp.to]);
    }
    for (const c of mineFacts.calls) {
      const r = ends(c.from, c.to);
      if (!r) continue;
      const e = edge(r[0], r[1]);
      if (r[2]) ctxEdges.add(e);
      e.calls++;
      note(e, [c.from, c.line, `${c.endpoint} (${c.to})`]);
    }
    const used = new Set<string>();
    // services and data stores, as on group boards (a database driver counts toward its store)
    for (const u of mineFacts.storeUses) {
      const a = boxOf(u.file);
      if (!a) continue;
      const e = edge(a, storeId(u.store));
      e.uses++;
      if (u.op === "read") e.reads = (e.reads ?? 0) + 1;
      else e.writes = (e.writes ?? 0) + 1;
      note(e, [u.file, u.line, `${u.collection} (${u.op})`]);
      used.add(e.b);
    }
    for (const u of mineFacts.serviceUses) {
      const a = boxOf(u.from);
      if (!a) continue;
      const st = merged.get(u.service);
      const e = edge(a, st ? storeId(st) : svcId(u.service));
      e.uses++;
      note(e, [u.from, u.line, u.spec]);
      used.add(e.b);
    }
    const boxes = [...[...shown].sort().map((f) => FILE + f), ...(shown.size < leaf.files.length ? [MORE] : [])];
    boards[leaf.id] = finishFileBoard(boxes, MORE, isFileId, edges.values(), ctxEdges, used, (id) => !!nodes[id], profile);
    for (const f of shown) {
      const sf = info.get(f);
      files[f] = { loc: sf?.loc ?? 0, exports: topExports(f, sf?.exports ?? []) };
    }
  }
  return { boards, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
}

/** The exports line of a file box, short enough to keep boxes narrow. Shared by layout and viewer. */
export function exportLine(names: string[]): string {
  const s = names.join(", ");
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}
export const linesLabel = (loc: number) => `${loc} line${loc === 1 ? "" : "s"}`;
export const moreLabel = (n: number) => `+${n} more file${n === 1 ? "" : "s"}`;

/** Exports named like the file first (the component or module it is about), then the rest A-Z. */
function topExports(path: string, names: string[]): string[] {
  const stem = baseName(path).replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const score = (n: string) => (n.toLowerCase() === stem ? 0 : n.toLowerCase().includes(stem) || stem.includes(n.toLowerCase()) ? 1 : 2);
  return [...names].sort((x, y) => score(x) - score(y) || x.localeCompare(y)).slice(0, MAX_EXPORTS);
}
