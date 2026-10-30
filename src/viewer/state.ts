// Page data, the current board and selection, and small helpers every module shares.
import type { Features } from "../features.ts";
import type { Board, ModelEdge, ModelNode } from "../model/rollup.ts";
import type { BoardLayout } from "../build/layout.ts";
import type { ModelTour } from "../model/tours.ts";
import type { Tour } from "../model/compose.ts";
import type { ModelFlow } from "../model/flows.ts";
import type { FileEdge } from "../model/fgraph.ts";
import type { Category, StoryActor } from "../model/schema.ts";
import { collLabel } from "../model/storeboards.ts";

/** Board id of the story level (level 0) in `boards` and `layout`. Group ids are slugs, so it can't clash. */
export const STORY = "_story";

/** Paths are stored once in `paths` and referred to by index (see build/html.ts). */
export type PathRef = number | string;
export type PageEdge = Omit<ModelEdge, "ev"> & { ev: [file: PathRef, line: number, target: PathRef][] };
/** [name, readers, writers, file, ±line, ...]: a negative line is a write (see build/html.ts). */
export type PageCollection = [name: string, reads: string[], writes: string[], ...ev: PathRef[]];
/** A collection's field: [name, how it is used ("d"eclared, "w"ritten, "q"ueried, "r"ead), places, ...[file, line, how]]. */
export type PageField = [name: string, hows: string, sites: number, ...ev: (PathRef | number | string)[]];
export type PageBoard = Omit<Board, "edges" | "collections"> & { edges: PageEdge[]; collections?: Record<string, PageCollection[]> };
export type PageNode = Omit<ModelNode, "files"> & {
  files: PathRef[];
  /** Only in `ViewerData.tree`: a Simple split's part or bucket, which Default and the stops above it skip (viewer/finetree.ts). */
  fine?: boolean;
};

export interface ViewerData {
  /** Launch switches that differ from the defaults (features.ts); absent means launch defaults. */
  features?: Partial<Features>;
  repo: string;
  sha: string | null;
  paths: string[];
  nodes: Record<string, PageNode>;
  services: Record<string, string>;
  /** Service/store id -> category, and the glyph for each category on the page (only those: see build/html.ts). */
  categories?: Record<string, Category>;
  icons?: Partial<Record<Category, string>>;
  /** Service id -> what the code uses it for ("sign-in"): its box's sub line and its panel's first line. */
  does?: Record<string, string>;
  boards: Record<string, PageBoard>;
  layout: Record<string, BoardLayout>;
  /** File boxes on leaf boards, keyed "@<path index>": [lines, ...top exports]. */
  files?: Record<string, [number, ...string[]]>;
  /** "@<path index>" -> its box's name, for files whose basename repeats in their leaf (model/filenames.ts). */
  names?: Record<string, string>;
  tours?: ModelTour[];
  /** Tours the build derived from the file graph (model/derivedtours.ts), source "derived"; listed after `tours`. */
  derivedTours?: Tour[];
  /** Per board: the flows its walkthrough steps through (viewer/walk.ts). */
  flows?: Record<string, Omit<ModelFlow, "named">[]>;
  /** Per store id, per collection: its fields. A store with an entry opens into a board of its collections (collections.ts). */
  stores?: Record<string, Record<string, PageField[]>>;
  /** Every file-to-file connection once, by index into `paths` (model/fgraph.ts has the format). */
  fgraph?: FileEdge<number>[];
  /**
   * The detail dial's Simple stop (Claude's named splits), as what differs from Default: nodes that
   * are new or change, and boards that are new or change (model/simple.ts). Absent without splits.
   */
  simple?: { nodes: Record<string, PageNode>; boards: Record<string, PageBoard> };
  /** Not shipped: set by unpack.ts. `nodes` plus the Simple splits as `fine` nodes (viewer/finetree.ts); `nodes` itself without splits. */
  tree?: Record<string, PageNode>;
  /** Level 0 (story.ts): its board is boards[STORY] / layout[STORY]. */
  story?: { actors: Record<string, StoryActor>; narrative: string[] };
}

export const st = {
  data: null as unknown as ViewerData,
  cur: "root",
  /** Current and fitted viewBox of the board SVG. */
  view: [0, 0, 0, 0] as number[],
  base: [0, 0, 0, 0] as number[],
  svgEl: null as unknown as SVGSVGElement,
  /** `n:<id>` or `e:<a>><b>`, or null for the overview. */
  selected: null as string | null,
  /** Set while a pan drag moved far enough that the release should not count as a click. */
  dragged: false,
};

export const N = () => st.data.nodes;
export const S = () => st.data.services;
export const path = (x: PathRef) => (typeof x === "number" ? st.data.paths[x] : x);
export const $ = (id: string) => document.getElementById(id)!;
export { esc } from "./esc.ts";
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The board the page opens on and "Overview" names: the story level when there is one. */
export const home = () => (st.data.story ? STORY : "root");
export const actorOf = (id: string) => st.data.story?.actors[id];

export const board = () => st.data.boards[st.cur];
export const nameOf = (id: string) => S()[id] || N()[id]?.name || actorOf(id)?.name || (isFile(id) ? fileName(id) : isColl(id) ? collLabel(id.slice(2)) : id);
/** Collection boxes on a store board: "c:<path>" (model/storeboards.ts). */
export const isColl = (id: string) => id.startsWith("c:");
/** The current board is a store opened into its collections. */
export const onStoreBoard = () => !!st.data.stores?.[st.cur];
/** On a store board the selection draws its own reads and writes (a connection: its collection's). */
export function storeFocus(): string | null {
  const h = st.selected;
  if (!h || !onStoreBoard()) return null;
  return h.startsWith("e:") ? h.slice(2).split(">")[1] : h.slice(2);
}
/** File boxes on a leaf's board: "@<path index>", and "+more" for the files it doesn't draw. */
export const isFile = (id: string) => id[0] === "@" || id === "+more";
export const filePathOf = (id: string) => (id[0] === "@" ? st.data.paths[Number(id.slice(1))] : "");
const fileName = (id: string) => (id === "+more" ? "More files" : st.data.names?.[id] ?? filePathOf(id).slice(filePathOf(id).lastIndexOf("/") + 1));
export const isCtx = (id: string) => board().context.includes(id);
export const isOpenable = (id: string) => !!((N()[id] || st.data.stores?.[id]) && st.data.layout[id]);
export const edgeKey = (e: PageEdge) => `${e.a}>${e.b}`;
export const catOf = (id: string) => st.data.categories?.[id];
export const iconOf = (id: string) => { const c = catOf(id); return c && st.data.icons?.[c]; };
export const isStore = (id: string) => id.startsWith("store-") && !!S()[id];
export function collectionsOf(id: string) {
  return (board().collections?.[id] ?? []).map(([name, reads, writes, ...ev]) => ({
    name, reads, writes,
    ev: ev.flatMap((f, i) => (i % 2 ? [] : [[f, Math.abs(ev[i + 1] as number), (ev[i + 1] as number) < 0 ? "write" : "read"] as [PathRef, number, string]])),
  }));
}
/** Lines under a store's name; must match storeLines() in build/boxsize.ts, which sized the box. */
export function storeLines(id: string): string[] {
  const listed = board().collections?.[id]?.length ?? 0;
  // file boards carry no per-board list: count the whole store, as build/boxsize.ts does, rather than claim none
  return [plural(listed || Object.keys(st.data.stores?.[id] ?? {}).length, "collection")];
}
export const storeVerb = (e: Pick<PageEdge, "reads" | "writes">) => (e.reads && e.writes ? "reads & writes" : e.writes ? "writes" : e.reads ? "reads" : "");
/** The text drawn on an arrow: a story verb or a store verb. Counts are shown only in the panels. */
export const wireLabel = (e: PageEdge): string => (e.says ? e.says.join(" · ") : storeVerb(e));
/** Counts as text, for the panels' connection lists. */
export function edgeLabel(e: PageEdge): string {
  if (e.says) return e.says.join(" · ");
  if (e.reads || e.writes) return storeVerb(e);
  if (e.uses) return "";
  const p: string[] = [];
  if (e.imports) p.push(String(e.imports));
  if (e.calls) p.push(plural(e.calls, "call"));
  return p.join(" · ");
}
export const edgeClass = (e: PageEdge) => (e.says ? "story" : e.reads || e.writes ? "data" : e.uses ? "svc" : e.imports ? "" : "call");
