// A group tree for rolling boards up in the page (stops.ts rollBoards): where each file sits in it.
// The Simple stop uses it on its tree, the fine nodes shown (stopsimple.ts). The detail dial's other
// stops cut a board at a box budget instead (budget.ts, docs/detail-dial-v2.md). Pure: no DOM.
import { idx } from "./budget.ts";
import type { PageNode } from "./state.ts";

export interface StopTree {
  /** The groups: a group's children are what its board draws. */
  nodes: Record<string, PageNode>;
  /** File (path index) -> its groups from the root's child down to its leaf. */
  chain: Map<number, string[]>;
  /** File (path index) -> its leaf. */
  leafOf: Map<number, string>;
}


export function stopTree(nodes: Record<string, PageNode>, paths: string[]): StopTree {
  const chain = new Map<number, string[]>(), leafOf = new Map<number, string>();
  for (const n of Object.values(nodes)) {
    if (n.children.length || n.id === "root") continue;
    const c: string[] = [];
    for (let id: string | null = n.id; id && id !== "root"; id = nodes[id].parent) c.unshift(id);
    for (const f of n.files) { chain.set(idx(f, paths), c); leafOf.set(idx(f, paths), n.id); }
  }
  return { nodes, chain, leafOf };
}
