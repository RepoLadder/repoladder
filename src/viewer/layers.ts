// The dial's layers (#327, docs/detail-dial-v2.md "Layers"): which group boards exist at a budget.
// A group has a board only while a board that exists draws it as a closed box; the tops (the
// Overview and root), store boards and every board at Default or Simple always exist. Pure: no DOM,
// so tests run it in Node.
import { cut, drawnHolder, extraBoxes, layersAt } from "./budget.ts";
import { STORY, type ViewerData } from "./state.ts";

const memo = new WeakMap<ViewerData, Map<number, Set<string>>>();

/** The group boards that exist at `budget` (budget.ts layersAt), cached per page. */
export function layers(data: ViewerData, budget: number): Set<string> {
  const m = memo.get(data) ?? memo.set(data, new Map()).get(data)!, extra = (id: string) => extraBoxes(data.nodes, data.boards[id], id);
  if (!m.has(budget)) m.set(budget, layersAt(data.tree ?? data.nodes, data.paths, budget, [["root", extra("root")], ...(data.story ? [["root", extraBoxes(data.nodes, data.boards[STORY], "root")] as [string, number]] : [])], extra));
  return m.get(budget)!;
}

/** Whether board `id` exists at `budget`. Ids that aren't groups are left alone. */
export const hasLayer = (data: ViewerData, budget: number, id: string): boolean =>
  !budget || !(data.tree ?? data.nodes)[id] || layers(data, budget).has(id);

const homeOf = (data: ViewerData) => (data.story ? STORY : "root");

/** The board above `id`: a level-1 part's is the Overview (the story level when there is one); null for the top. */
export function upOf(data: ViewerData, id: string): string | null {
  const h = homeOf(data), p = (data.tree ?? data.nodes)[id]?.parent;
  return id === h || id === "root" ? null : !p || p === "root" ? h : p;
}

/** The nearest board that exists at `budget`: `id` itself, else its nearest ancestor that does, else the top. */
export function layerOf(data: ViewerData, budget: number, id: string): string {
  let c = id;
  while (!hasLayer(data, budget, c)) c = (data.tree ?? data.nodes)[c]?.parent ?? "root";
  return c === "root" && id !== c ? homeOf(data) : c;
}

/** `hit` mapped onto `board`'s cut at `budget`, before that board is laid out: the drawn box or container that holds it. */
export function holdOn(data: ViewerData, budget: number, board: string, hit: string | null): string | null {
  const tree = data.tree ?? data.nodes, top = board === STORY ? "root" : board;
  const x = hit && drawnHolder(cut(tree, data.paths, top, budget, { extra: extraBoxes(data.nodes, data.boards[board], top) }), tree, data.paths, hit.slice(2).split(">")[0]);
  return x && x !== top ? `n:${x}` : null;
}
