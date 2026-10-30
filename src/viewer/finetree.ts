// The page's one group tree (docs/detail-dial-v2.md): Default's groups plus the Simple splits as
// regular nodes marked `fine`. A split leaf keeps its files and gains its parts as fine children; a
// bucketed group's children move under fine buckets. Default and every stop above it skip fine
// nodes (they're transparent: a fine node's children stand in its place); Simple shows them.
// `data.nodes` stays Default's tree, so nothing that draws Default changes. Pure: no DOM.
import type { PageNode, ViewerData } from "./state.ts";

const built = new WeakMap<ViewerData, Record<string, PageNode>>();

/** The tree with fine nodes: `data.tree` once unpack.ts set it, else built (and kept) here. Without splits, it is `data.nodes`. */
export function treeOf(data: ViewerData): Record<string, PageNode> {
  if (data.tree) return data.tree;
  let t = built.get(data);
  if (!t) built.set(data, (t = fineTree(data)));
  return t;
}

function fineTree(data: ViewerData): Record<string, PageNode> {
  const s = data.simple;
  if (!s) return data.nodes;
  const t: Record<string, PageNode> = { ...data.nodes };
  for (const [id, n] of Object.entries(s.nodes)) {
    const d = data.nodes[id];
    // a Default node that changes in Simple keeps Default's own fields (a split leaf its files) and takes Simple's children
    t[id] = d ? { ...d, children: n.children } : { ...n, fine: true };
  }
  // a bucketed child's parent is its bucket; the page doesn't ship nodes that change only that
  for (const n of Object.values(s.nodes)) for (const c of n.children) if (t[c].parent !== n.id) t[c] = { ...t[c], parent: n.id };
  return t;
}

/** `id`'s children with fine nodes skipped: Default's children. */
export const coarseKids = (t: Record<string, PageNode>, id: string): string[] => t[id].children.flatMap((c) => (t[c].fine ? coarseKids(t, c) : [c]));

/** `id`'s nearest ancestor that isn't fine: its Default parent. */
export function coarseParent(t: Record<string, PageNode>, id: string): string | null {
  let p = t[id].parent;
  while (p && t[p].fine) p = t[p].parent;
  return p;
}

/** The Default tree, read back from the fine tree (equals `data.nodes`). */
export function coarseNodes(t: Record<string, PageNode>): Record<string, PageNode> {
  const out: Record<string, PageNode> = {};
  for (const [id, n] of Object.entries(t)) if (!n.fine) out[id] = { ...n, parent: coarseParent(t, id), children: coarseKids(t, id) };
  return out;
}

/**
 * The Simple tree: every node shown, unmarked. A group holds no files of its own and lists no
 * pages or endpoints (they're leaf fields, model/rollup.ts), so a split leaf drops them to its parts.
 */
export function fineNodes(t: Record<string, PageNode>): Record<string, PageNode> {
  const out: Record<string, PageNode> = {};
  for (const [id, { fine, ...n }] of Object.entries(t)) {
    if (!n.children.length || !n.files.length) { out[id] = n; continue; }
    const { pages, endpoints, ...g } = n;
    out[id] = { ...g, files: [] };
  }
  return out;
}
