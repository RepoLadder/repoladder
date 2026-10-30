// The detail dial's Simple stop: Default plus the finer levels Claude named
// in the grouping's splits: the page's tree with its fine nodes shown (finetree.ts). The page
// carries only what it can't derive (model/simple.ts): the new and changed nodes, and the boards
// that draw a split's parts or buckets, new file boards and changed store boards. Boards below a bucket level are rolled up here from the file graph, by the
// same rules as the build, since their "elsewhere" boxes can now be a bucket; every other
// board is Default's. Pure: no DOM.
import { coarseParent, fineNodes, treeOf } from "./finetree.ts";
import type { ViewerData } from "./state.ts";
import { rollBoards, type StopData } from "./stops.ts";
import { stopTree } from "./stoptree.ts";

/**
 * Simple only adds ids: `toDefault` maps each Simple-only id (a split's part or bucket) to the
 * Default box that holds it: its nearest ancestor that Default has. Without splits in the page,
 * Simple is Default.
 */
export function simpleStop(data: ViewerData): StopData & { toDefault: Record<string, string> } {
  const s = data.simple;
  if (!s) return { nodes: data.nodes, boards: data.boards, toDefault: {} };
  const tree = treeOf(data), nodes = fineNodes(tree);
  const toDefault: Record<string, string> = {};
  for (const [id, n] of Object.entries(tree)) if (n.fine) toDefault[id] = coarseParent(tree, id)!;
  // a board is changed when it, or a group above it, is new in Simple (a store board's id is no node)
  const changed = (id: string) => {
    for (let x: string | null | undefined = id; x && x !== "root"; x = nodes[x]?.parent) if (toDefault[x]) return true;
    return false;
  };
  const t = stopTree(nodes, data.paths);
  const boards = rollBoards(data, t, (id) => s.boards[id] ?? (changed(id) ? undefined : data.boards[id]), changed);
  return { nodes: t.nodes, boards, toDefault };
}
