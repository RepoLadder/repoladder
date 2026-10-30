// A stop's boards as the build's Model, so the page sizes and lays them out with the build's own
// code (build/boxsize.ts, build/engines/elkboard.ts) and they match the Default boards beside them.
// Only what sizing, lanes and outlines read is filled in. File boxes go back to the build's ids
// ("f:<path>", model/fileboards.ts) on file boards, and `toPage` turns laid-out ids back into "@<i>".
import type { BoardLayout } from "../build/layout.ts";
import type { Board, BoardCollection, Model, ModelEdge, ModelNode } from "../model/rollup.ts";
import type { StopData } from "./stops.ts";
import type { PageBoard, ViewerData } from "./state.ts";

export interface StopModel {
  model: Model;
  /** A layout of the Model's board in the page's ids. */
  toPage: (l: BoardLayout) => BoardLayout;
  /** A box id of the Model in the page's ids ("f:<path>" -> "@<i>"). */
  pageId: (id: string) => string;
}

const FILE = "f:";

/** File box ids both ways: the page's "@<i>" and the Model's "f:<path>" (other ids pass through). */
export function fileIds(P: string[]) {
  const index = new Map(P.map((p, i) => [p, i]));
  return {
    toF: (id: string) => (id[0] === "@" ? `${FILE}${P[Number(id.slice(1))]}` : id),
    toAt: (id: string) => (id.startsWith(FILE) ? `@${index.get(id.slice(FILE.length))}` : id),
  };
}

export function stopModel(data: ViewerData, s: StopData): StopModel {
  const P = data.paths, { toF, toAt } = fileIds(P);
  const path = (x: string | number) => (typeof x === "number" ? P[x] : x);
  const nodes: Record<string, ModelNode> = {};
  for (const [id, n] of Object.entries(s.nodes)) nodes[id] = { ...n, files: n.files.map(path) };
  const board = (b: PageBoard, files: boolean): Board => {
    const f = files ? toF : (x: string) => x;
    const collections: Record<string, BoardCollection[]> = {};
    for (const [id, cs] of Object.entries(b.collections ?? {})) collections[id] = cs.map(([name, reads, writes]) => ({ name, reads, writes, ev: [] }));
    return {
      nodes: b.nodes.map(f), context: b.context.map(f), hubs: b.hubs.map(f), throughout: b.throughout,
      edges: b.edges.map((e): ModelEdge => ({ ...e, a: f(e.a), b: f(e.b), ev: [] })),
      ...(b.collections ? { collections } : {}),
    };
  };
  const boards: Record<string, Board> = {};
  for (const [id, b] of Object.entries(s.boards)) boards[id] = board(b, !!nodes[id] && !nodes[id].children.length);
  const files: NonNullable<Model["files"]> = {};
  for (const [k, [loc, ...exports]] of Object.entries(data.files ?? {})) files[P[Number(k.slice(1))]] = { loc, exports };
  const model = {
    version: 1, repo: data.repo, sha: data.sha, github: null, summary: "",
    nodes, services: data.services, categories: data.categories, does: data.does, boards, files,
    names: data.names && Object.fromEntries(Object.entries(data.names).map(([k, n]) => [P[Number(k.slice(1))], n])),
    stores: data.stores as unknown as Model["stores"],
  } as Model;
  const toPage = (l: BoardLayout): BoardLayout => ({
    n: l.n.map(([id, ...r]) => [toAt(id), ...r]),
    e: l.e.map(([a, b, ...r]) => [toAt(a), toAt(b), ...r]),
  });
  return { model, toPage, pageId: toAt };
}
