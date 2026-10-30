// Store boards: opening a data store shows one box per collection (subcollections inside their
// parent), the fields the code writes, queries and reads on each, and the parts that read and write
// each collection as context boxes with reads/writes arrows. Every collection is drawn; the readers
// are drawn one level below the top when they fit beside them in the box budget, else the top-level
// parts, else none, and each collection's panel lists them (storeReaders). Every arrow, at any level,
// is a store use from the facts. With dozens of collections, drawing every arrow is a hairball: the
// edges are listed (not major), and the viewer draws those of the selected collection or part
// (collections.ts).
import type { Facts, StoreField } from "./schema.ts";
import type { Board, Evidence, ModelEdge, ModelNode } from "./rollup.ts";

/** A collection box's id on a store board is its path behind this prefix. */
export const COLL = "c:";
export const isCollId = (id: string) => id.startsWith(COLL);
/** The box a store opens into is a board keyed by the store's own id ("store-firestore"). */
export const isStoreBoardId = (id: string) => id.startsWith("store-");
/** Fields drawn on a collection box before "+N more". */
export const TOP_FIELDS = 6;
const EVIDENCE = 3;
const FIELD_EVIDENCE = 1;
/** BUDGET.boxes in build/budget.ts. The page imports this module, so it can't import the build or
 * budgetsplit.ts (which pulls in rollup); test/storeboards.test.ts asserts they match. */
export const STORE_BOXES = 12;

export type StoreReaders = "parts" | "top" | "listed";
/** Which readers a store board draws: the parts one level down when they fit beside every collection
 * box, else the top-level parts, else none (the panel lists them). */
export function storeReaders(collections: number, parts: number, top: number, boxes = STORE_BOXES): StoreReaders {
  return collections + parts <= boxes ? "parts" : collections + top <= boxes ? "top" : "listed";
}

export type How = StoreField["how"];
/** [file, line, how] */
export type FieldEvidence = [file: string, line: number, how: How];
export interface ModelField {
  name: string;
  /** Declared in a schema (Prisma), rather than inferred from code. */
  declared?: true;
  /** How the code uses it, in the order write, query, read (declared fields too). */
  hows: How[];
  /** Places it shows up, one per kind first (see FIELD_EVIDENCE). */
  ev: FieldEvidence[];
  /** All the places it shows up. */
  sites: number;
}
export interface ModelCollection {
  /** Most used first, then A-Z: the box draws the first few. */
  fields: ModelField[];
}

const HOW_ORDER: How[] = ["declared", "write", "query", "read"];

/** Display name of a collection box: its last path segment ("Companies/Kiosks" -> "Kiosks"). */
export const collLabel = (name: string) => (name.startsWith("*/") ? `${name.slice(2)} (any parent)` : name.slice(name.lastIndexOf("/") + 1));
/** The collection a subcollection sits in, or null at the top level. */
export const parentColl = (name: string) => (name.startsWith("*/") || !name.includes("/") ? null : name.slice(0, name.lastIndexOf("/")));

/** The "+N more" line of a collection box, or null when every field is drawn. */
export const moreFields = (n: number, shown: number) => (n > shown ? `+${n - shown} more` : null);

export function buildStoreBoards(facts: Facts, nodes: Record<string, ModelNode>, leafOf: Map<string, string>): { boards: Record<string, Board>; collections: Record<string, Record<string, ModelCollection>> } {
  // A file's groups from the top down. Readers are drawn one level below the top (the parts inside
  // each top-level part), so an arrow says more than "the backend"; a top-level part with no children
  // stands for itself. When those don't fit, they fold up to the top-level parts (storeReaders).
  const chain = (file: string): string[] => {
    const c: string[] = [];
    for (let id: string | null | undefined = leafOf.get(file); id && id !== "root"; id = nodes[id]?.parent) c.unshift(id);
    return c;
  };
  const fine = (c: string[]) => c[1] ?? c[0] ?? null;
  const top = (c: string[]) => c[0] ?? null;
  const boards: Record<string, Board> = {};
  const collections: Record<string, Record<string, ModelCollection>> = {};
  for (const st of [...(facts.stores ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const sid = `store-${st.id}`; // storeId() in rollup.ts
    const names = new Set<string>();
    for (const u of facts.storeUses) if (u.store === st.id) names.add(u.collection);
    for (const f of facts.storeFields ?? []) if (f.store === st.id) names.add(f.collection);
    // a subcollection's parent is a collection even when the code never reads or writes it directly
    for (const n of [...names]) for (let p = parentColl(n); p; p = parentColl(p)) names.add(p);
    const sorted = [...names].sort();

    // a rolled-up edge sums the uses of its children's edges: each use counts once, at its level
    const edgesAt = (level: (c: string[]) => string | null): ModelEdge[] => {
      const edges = new Map<string, ModelEdge>();
      for (const u of facts.storeUses) {
        if (u.store !== st.id) continue;
        const a = level(chain(u.file));
        if (!a) continue;
        const k = `${a}>${COLL}${u.collection}`;
        let e = edges.get(k);
        if (!e) edges.set(k, (e = { a, b: COLL + u.collection, imports: 0, calls: 0, uses: 0, major: false, ev: [] }));
        e.uses++;
        if (u.op === "read") e.reads = (e.reads ?? 0) + 1;
        else e.writes = (e.writes ?? 0) + 1;
        const ev: Evidence = [u.file, u.line, `${u.collection} (${u.op})`];
        if (e.ev.length < EVIDENCE && !e.ev.some((x) => x[0] === ev[0] && x[2] === ev[2])) e.ev.push(ev);
      }
      return [...edges.values()].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
    };
    const partsOf = (l: ModelEdge[]) => [...new Set(l.map((e) => e.a))].sort();
    const fineList = edgesAt(fine), fineParts = partsOf(fineList);
    const topList = edgesAt(top), topParts = partsOf(topList);
    const colls = sorted.map((n) => COLL + n);
    const r = storeReaders(colls.length, fineParts.length, topParts.length);
    // "listed" keeps the one-level-down edges: the panel names the specific part
    const [list, parts] = r === "parts" ? [fineList, fineParts] : r === "top" ? [topList, topParts] : [fineList, []];
    boards[sid] = { nodes: [...colls, ...parts], edges: list, throughout: [], hubs: [], context: parts };

    const byColl: Record<string, ModelCollection> = {};
    for (const n of sorted) byColl[n] = { fields: fieldsOf((facts.storeFields ?? []).filter((f) => f.store === st.id && f.collection === n)) };
    collections[sid] = byColl;
  }
  return { boards, collections };
}

function fieldsOf(facts: StoreField[]): ModelField[] {
  const by = new Map<string, StoreField[]>();
  for (const f of facts) {
    if (!f.field) continue; // a declared model with no fields
    let l = by.get(f.field);
    if (!l) by.set(f.field, (l = []));
    l.push(f);
  }
  const out: ModelField[] = [];
  for (const [name, fs] of by) {
    const hows = HOW_ORDER.filter((h) => fs.some((f) => f.how === h));
    // one place per kind first, so the evidence shows where it is written and where it is read
    const ev: FieldEvidence[] = [];
    for (const h of hows) { const f = fs.find((x) => x.how === h)!; ev.push([f.file, f.line, h]); }
    for (const f of fs) if (ev.length < Math.max(FIELD_EVIDENCE, hows.length) && !ev.some((x) => x[0] === f.file && x[1] === f.line)) ev.push([f.file, f.line, f.how]);
    out.push({ name, ...(hows.includes("declared") ? { declared: true as const } : {}), hows: hows.filter((h) => h !== "declared"), ev: ev.slice(0, Math.max(FIELD_EVIDENCE, hows.length)), sites: fs.filter((f) => f.how !== "declared").length });
  }
  // declared fields keep the schema's order; inferred ones go most used first
  const line = (f: ModelField) => (f.declared ? f.ev.find((x) => x[2] === "declared")![1] : 0);
  return out.sort((x, y) => (x.declared === y.declared ? 0 : x.declared ? -1 : 1) || line(x) - line(y) || y.sites - x.sites || x.name.localeCompare(y.name));
}
