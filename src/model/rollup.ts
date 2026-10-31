import { boardEnds, EVIDENCE_PER_EDGE, finishGroupBoard } from "./rollrules.ts";
import { endpointLabel } from "./endpoints.ts";
import type { Category, Facts, GroupNode, Grouping, PackageKind, StoryActor } from "./schema.ts";
import type { Snippet } from "./snippets.ts";
import { STORY_REF, resolveEntry, topLevelOf } from "./story.ts";
import { buildFileBoards, type ModelFile } from "./fileboards.ts";
import { DEFAULT_PROFILE, type Profile } from "./profile.ts";
import { fileNames } from "./filenames.ts";
import { buildStoreBoards, type ModelCollection } from "./storeboards.ts";
import type { ModelTour } from "./tours.ts";
import type { Tour } from "./compose.ts";
import type { ModelFlow } from "./flows.ts";
import { fileGraph, passesThrough, type FileEdge } from "./fgraph.ts";
import type { ModelSimple } from "./simple.ts";

// the shared roll-up rules, re-exported for the build and its tests
export { markContext, markMajor, reduceShortcuts } from "./rollrules.ts";

export type Evidence = [file: string, line: number, target: string];

export interface ModelNode {
  id: string;
  name: string;
  summary: string;
  parent: string | null;
  children: string[];
  /** Leaf nodes only: the files in this group. */
  files: string[];
  /** Leaf nodes only, when any: routes whose page component lives in this group. */
  pages?: string[];
  /** Leaf nodes only, when any: display labels (`GET /tasks`) of the server endpoints defined in this group (panel rows and search). */
  endpoints?: string[];
  count: number;
  loc: number;
  /** What the part is, by the bulk of its code (lines): its package's kind, with endpoint files counted as backend. Absent on the root. */
  kind?: PackageKind;
}

export interface ModelEdge {
  a: string;
  b: string;
  imports: number;
  calls: number;
  uses: number; // service SDK imports, or database operations for a store
  /** Store edges only: how many of `uses` are reads and writes. */
  reads?: number;
  writes?: number;
  /** Drawn on the diagram; minor edges are only listed in the details panel. */
  major: boolean;
  ev: Evidence[];
  /**
   * Story edges only (actor -> level-1 part): what the actor does there. These are declared in
   * the grouping, not read from the code; `ev` holds the validated entry point of each use.
   */
  says?: string[];
  /** Into a part most of its siblings import. When drawn, the viewer may style it lighter. */
  hub?: true;
}

/** What is drawn when a node is opened: its children, the services they touch, and the edges between them. */
export interface Board {
  nodes: string[];
  edges: ModelEdge[];
  /** Services used so widely at this level that they're listed instead of drawn. */
  throughout: string[];
  /** Children imported by most of their siblings; edges into them are listed, not drawn. */
  hubs: string[];
  /** Parts outside this node that its children connect to, drawn as dashed context boxes. */
  context: string[];
  /** Per store node on this board: the collections its children touch, and which child reads or writes each. */
  collections?: Record<string, BoardCollection[]>;
}

export interface BoardCollection {
  name: string;
  /** Board node ids */
  reads: string[];
  writes: string[];
  /** [file, line, "read" | "write"] */
  ev: Evidence[];
}

/** Level 0, above the root: who uses the system and what for. */
export interface ModelStory {
  actors: Record<string, StoryActor>;
  /** Sentences that may contain [[id]] / [[id|text]] references (see story.ts). */
  narrative: string[];
  /** Actors, then the root board's boxes; actor edges first, then the root's major edges. */
  board: Board;
}

export interface Model {
  version: 1;
  repo: string;
  sha: string | null;
  /** For links to the code: see Facts.github. */
  github: Facts["github"];
  summary: string;
  /** The fidelity profile (profile.ts); absent for `full`, so a default model is unchanged. */
  profile?: Profile;
  nodes: Record<string, ModelNode>;
  services: Record<string, string>;
  /** Service and store id -> its category, which picks its icon. Absent in models built before categories. */
  categories?: Record<string, Category>;
  /** Service id -> what the code uses it for ("sign-in"), drawn under its name instead of "service". */
  does?: Record<string, string>;
  boards: Record<string, Board>;
  /** Files drawn as boxes on leaf boards (see fileboards.ts), keyed by path. */
  files?: Record<string, ModelFile>;
  /** Path -> its box's name, for files whose basename repeats in their leaf (filenames.ts); others go by basename. */
  names?: Record<string, string>;
  story?: ModelStory;
  /** Source lines around evidence, keyed "file:line" (snippets.ts); added at build time. */
  snippets?: Record<string, Snippet>;
  /** Guided walks through real edges (validated by resolveTours in tours.ts). */
  tours?: ModelTour[];
  /** Tours the build derived from the file graph, entry to sink, with no AI (derivedtours.ts); listed after `tours`. */
  derivedTours?: Tour[];
  /** Per board: chains of drawn arrows the viewer can play one at a time (flows.ts). */
  flows?: Record<string, ModelFlow[]>;
  /** Per store id: its collections and their fields; each store opens into a board keyed by its id (storeboards.ts). */
  stores?: Record<string, Record<string, ModelCollection>>;
  /** Every file-to-file connection once, for boards the viewer rolls up itself (fgraph.ts). */
  fgraph?: FileEdge[];
  /** The detail dial's Simple stop, as what differs from Default (simple.ts); absent when the grouping has no splits. */
  simple?: ModelSimple;
}

export const svcId = (id: string) => `svc-${id}`;
export const storeId = (id: string) => `store-${id}`;
const EVIDENCE_PER_COLLECTION = 3;

/**
 * A store and a service can be the same backing system seen two ways: the driver import
 * ("PostgreSQL" from @prisma/client or pg) and the reads and writes ("Database (Prisma)"). Those
 * are drawn as one node, the store, and the service's imports become evidence on its edges.
 * Prisma runs on PostgreSQL, MySQL or SQLite (the driver adapter's database); the Supabase client is the Supabase database; the Firestore
 * SDK (firebase/firestore, firebase-admin/firestore) is the Firestore store. The rest of Firebase is
 * told apart by import subpath in analyze/services.ts (Firebase Auth, Cloud Storage, …).
 */
const SAME_SYSTEM: Record<string, string[]> = { prisma: ["postgres", "mysql", "sqlite"], supabase: ["supabase"], firestore: ["firestore"] };

/** Service id -> the store id that absorbs it, for the stores present in these facts. */
export function mergedServices(facts: Facts): Map<string, string> {
  const into = new Map<string, string>();
  for (const st of [...(facts.stores ?? [])].sort((x, y) => x.id.localeCompare(y.id)))
    for (const svc of SAME_SYSTEM[st.id] ?? []) if (!into.has(svc)) into.set(svc, st.id);
  return into;
}

/** Builds the N-level model. Edges always come from the facts, rolled up to each level. */
export function buildModel(facts: Facts, grouping: Grouping, leafOf: Map<string, string>, profile: Profile = DEFAULT_PROFILE): Model {
  const nodes: Record<string, ModelNode> = {
    root: { id: "root", name: facts.repo, summary: grouping.summary, parent: null, children: [], files: [], count: 0, loc: 0 },
  };
  const add = (g: GroupNode, parent: string) => {
    nodes[g.id] = { id: g.id, name: g.name, summary: g.summary, parent, children: [], files: [], count: 0, loc: 0 };
    nodes[parent].children.push(g.id);
    g.children?.forEach((c) => add(c, g.id));
  };
  grouping.children.forEach((g) => add(g, "root"));

  // path from root's child down to the file's leaf, e.g. ["web", "web-components", "web-components-billing"]
  const chain = new Map<string, string[]>();
  for (const f of facts.files) {
    const leaf = leafOf.get(f.path);
    if (!leaf) continue;
    const c: string[] = [];
    for (let id: string | null = leaf; id && id !== "root"; id = nodes[id].parent) c.unshift(id);
    chain.set(f.path, c);
    nodes[leaf].files.push(f.path);
    for (const id of ["root", ...c]) { nodes[id].count++; nodes[id].loc += f.loc; }
  }

  assignKinds(facts, nodes, chain);

  for (const pg of facts.pages) {
    const leaf = leafOf.get(pg.file);
    if (leaf) (nodes[leaf].pages ??= []).push(pg.route);
  }
  for (const ep of facts.endpoints) {
    const leaf = leafOf.get(ep.file);
    if (leaf) (nodes[leaf].endpoints ??= []).push(endpointLabel(ep));
  }
  for (const n of Object.values(nodes)) {
    if (n.pages) n.pages = [...new Set(n.pages)].sort();
    if (n.endpoints) n.endpoints = [...new Set(n.endpoints)].sort();
  }

  const merged = mergedServices(facts);
  const services: Record<string, string> = {};
  for (const s of facts.services) if (!merged.has(s.id)) services[svcId(s.id)] = s.name;
  // Stores are drawn like services (a cylinder), so they share the name table.
  for (const s of facts.stores ?? []) services[storeId(s.id)] = s.name;
  const categories: Record<string, Category> = {};
  for (const s of facts.services) if (!merged.has(s.id)) categories[svcId(s.id)] = s.category ?? "other";
  for (const s of facts.stores ?? []) categories[storeId(s.id)] = "database";
  const does: Record<string, string> = {};
  for (const s of facts.services) if (!merged.has(s.id) && s.does) does[svcId(s.id)] = s.does;

  const boards: Record<string, Board> = {};
  for (const n of Object.values(nodes)) {
    if (!n.children.length) continue;
    const own: string[] = [];
    for (let id: string | null = n.id; id && id !== "root"; id = nodes[id].parent) own.unshift(id);
    const { childOf, ends } = boardEnds(own, (file: string) => chain.get(file));
    const ctxEdges = new Set<ModelEdge>();
    const edges = new Map<string, ModelEdge>();
    const edge = (a: string, b: string) => {
      const k = `${a}>${b}`;
      let e = edges.get(k);
      if (!e) edges.set(k, (e = { a, b, imports: 0, calls: 0, uses: 0, major: false, ev: [] }));
      return e;
    };
    // one example per file, so the evidence shows how widespread a connection is
    const note = (e: ModelEdge, ev: Evidence, max = EVIDENCE_PER_EDGE) => {
      if (e.ev.length < max && !e.ev.some((x) => x[0] === ev[0])) e.ev.push(ev);
    };

    for (const imp of facts.imports) {
      if (passesThrough(imp)) continue; // barrels; consumers are already routed to the real file
      const r = ends(imp.from, imp.to);
      if (!r) continue;
      const e = edge(r[0], r[1]);
      if (r[2]) ctxEdges.add(e);
      e.imports++;
      note(e, [imp.from, imp.line, imp.to]);
    }
    for (const c of facts.calls) {
      const r = ends(c.from, c.to);
      if (!r) continue;
      const e = edge(r[0], r[1]);
      if (r[2]) ctxEdges.add(e);
      e.calls++;
      note(e, [c.from, c.line, `${c.endpoint} (${c.to})`]);
    }
    const used = new Set<string>();
    for (const u of facts.serviceUses) {
      const a = childOf(u.from);
      if (!a || merged.has(u.service)) continue;
      const e = edge(a, svcId(u.service));
      e.uses++;
      note(e, [u.from, u.line, u.spec]);
      used.add(svcId(u.service));
    }
    const colls = new Map<string, Map<string, BoardCollection>>();
    for (const u of facts.storeUses ?? []) {
      const a = childOf(u.file);
      if (!a) continue;
      const sid = storeId(u.store);
      const e = edge(a, sid);
      e.uses++;
      if (u.op === "read") e.reads = (e.reads ?? 0) + 1;
      else e.writes = (e.writes ?? 0) + 1;
      // fewer here: the store's collection list carries the per-collection evidence
      note(e, [u.file, u.line, `${u.collection} (${u.op})`], 3);
      used.add(sid);
      let byName = colls.get(sid);
      if (!byName) colls.set(sid, (byName = new Map()));
      let c = byName.get(u.collection);
      if (!c) byName.set(u.collection, (c = { name: u.collection, reads: [], writes: [], ev: [] }));
      const side = u.op === "read" ? c.reads : c.writes;
      if (!side.includes(a)) side.push(a);
      // one example per part and operation first, so the evidence shows both sides
      if (c.ev.length < EVIDENCE_PER_COLLECTION && !c.ev.some((x) => x[2] === u.op && childOf(x[0]) === a)) c.ev.push([u.file, u.line, u.op]);
    }
    // after the store's own operations, so its evidence leads with reads and writes
    for (const u of facts.serviceUses) {
      const st = merged.get(u.service), a = childOf(u.from);
      if (!st || !a) continue;
      const e = edge(a, storeId(st));
      e.uses++;
      note(e, [u.from, u.line, u.spec]);
      used.add(storeId(st));
    }
    boards[n.id] = finishGroupBoard(n.id, n.children, edges.values(), ctxEdges, used, (id) => !!nodes[id]);
    if (colls.size) {
      const order = (ids: string[]) => ids.sort((x, y) => n.children.indexOf(x) - n.children.indexOf(y));
      boards[n.id].collections = Object.fromEntries([...colls].sort((x, y) => x[0].localeCompare(y[0])).map(([sid, m]) => [sid,
        [...m.values()].sort((x, y) => x.name.localeCompare(y.name)).map((c) => ({ ...c, reads: order(c.reads), writes: order(c.writes) }))]));
    }
  }
  const model: Model = { version: 1, repo: facts.repo, sha: facts.sha, github: facts.github, summary: grouping.summary, nodes, services, categories, ...(Object.keys(does).length ? { does } : {}), boards };
  // Leaf groups open into file boards.
  const fileBoards = buildFileBoards(facts, nodes, leafOf, profile);
  Object.assign(boards, fileBoards.boards);
  model.files = fileBoards.files;
  if (profile !== DEFAULT_PROFILE) model.profile = profile;
  const names = fileNames(Object.values(nodes));
  if (Object.keys(names).length) model.names = names;
  // Stores open into their collections.
  const storeBoards = buildStoreBoards(facts, nodes, leafOf);
  Object.assign(boards, storeBoards.boards);
  if (Object.keys(storeBoards.collections).length) model.stores = storeBoards.collections;
  if (grouping.story) model.story = buildStory(facts, grouping, leafOf, boards.root);
  const fgraph = fileGraph(facts, leafOf);
  if (fgraph.length) model.fgraph = fgraph;
  return model;
}

/** A narrative may name a service drawn as its store ([[svc-postgres]] under Prisma): link the store box. */
function aliasMerged(sentence: string, facts: Facts): string {
  const merged = mergedServices(facts);
  return sentence.replace(STORY_REF, (m, id: string, text?: string) => {
    const into = id.startsWith("svc-") ? merged.get(id.slice(4)) : undefined;
    return into ? `[[${storeId(into)}${text ? `|${text}` : ""}]]` : m;
  });
}

function buildStory(facts: Facts, grouping: Grouping, leafOf: Map<string, string>, root: Board): ModelStory {
  const story = grouping.story!;
  const leafTop = topLevelOf(grouping);
  const edges = new Map<string, ModelEdge>();
  for (const u of story.uses) {
    const k = `${u.actor}>${u.part}`;
    let e = edges.get(k);
    if (!e) edges.set(k, (e = { a: u.actor, b: u.part, imports: 0, calls: 0, uses: 0, major: true, ev: [], says: [] }));
    if (!e.says!.includes(u.says)) e.says!.push(u.says);
    // validation guarantees a hit inside the part; prefer it when an endpoint name is reused elsewhere
    const hits = resolveEntry(u.entry, facts);
    const hit = hits.find((h) => leafTop.get(leafOf.get(h.file) ?? "") === u.part) ?? hits[0];
    if (hit && !e.ev.some((x) => x[0] === hit.file && x[1] === hit.line)) e.ev.push([hit.file, hit.line, hit.label]);
  }
  const actorIds = story.actors.map((a) => a.id);
  return {
    actors: Object.fromEntries(story.actors.map((a) => [a.id, a])),
    narrative: story.narrative.map((s) => aliasMerged(s, facts)),
    board: {
      nodes: [...actorIds, ...root.nodes],
      edges: [
        ...[...edges.values()].sort((x, y) => actorIds.indexOf(x.a) - actorIds.indexOf(y.a) || x.b.localeCompare(y.b)),
        ...root.edges.filter((e) => e.major),
      ],
      throughout: root.throughout,
      hubs: root.hubs,
      context: [],
      ...(root.collections ? { collections: root.collections } : {}),
    },
  };
}

const KINDS: PackageKind[] = ["web", "backend", "scripts", "library"];

/** Each part's kind is the kind with the most lines in it; ties go to the earlier kind in KINDS. */
function assignKinds(facts: Facts, nodes: Record<string, ModelNode>, chain: Map<string, string[]>): void {
  const pkgKind = new Map(facts.packages.map((p) => [p.id, p.kind]));
  // a React Router page's action is the page's own form handler; the file stays web code (#295)
  const pageRoutes = new Set(facts.pages.map((p) => `${p.file}\0${p.route}`));
  const serverFiles = new Set(facts.endpoints.filter((e) => !(e.kind === "http" && pageRoutes.has(`${e.file}\0${e.name}`))).map((e) => e.file));
  const tally = new Map<string, Map<PackageKind, number>>();
  for (const f of facts.files) {
    const c = chain.get(f.path);
    const k = serverFiles.has(f.path) ? "backend" : pkgKind.get(f.pkg);
    if (!c || !k) continue;
    for (const id of c) {
      let t = tally.get(id);
      if (!t) tally.set(id, (t = new Map()));
      t.set(k, (t.get(k) ?? 0) + Math.max(1, f.loc));
    }
  }
  for (const [id, t] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
    let best: PackageKind | undefined;
    for (const k of KINDS) if (t.has(k) && (!best || t.get(k)! > t.get(best)!)) best = k;
    nodes[id].kind = best;
  }
}
