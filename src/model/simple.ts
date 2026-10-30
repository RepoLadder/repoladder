// What the page carries for the Simple stop: only what differs from Default. Simple only adds
// levels (model/splits.ts), so most boards are the same; the ones that change are the boards of
// split nodes, of the new parts and buckets, and of the groups under a bucket level (their
// "elsewhere" boxes can now be a bucket). They're rolled up by the same buildModel as Default, so
// every arrow still comes from the facts. Nothing is laid out: the viewer lays Simple boards out
// when the dial turns to it, like the other in-browser stops.
import { buildModel, type Board, type Model, type ModelNode } from "./rollup.ts";
import type { Facts } from "./schema.ts";
import type { SimpleTree } from "./splits.ts";

export interface ModelSimple {
  /** Nodes new in Simple, and Default nodes that change there besides their parent (a split leaf becomes a group, a split group gets buckets). */
  nodes: Record<string, ModelNode>;
  /** Boards new in Simple, and Default boards that change there, keyed by node id. */
  boards: Record<string, Board>;
}

const differs = <T>(a: T | undefined, b: T) => !a || JSON.stringify(a) !== JSON.stringify(b);

/**
 * Ships the boards the page can't roll up itself (viewer/stopsimple.ts): those that draw a new
 * part or bucket as one of their own boxes (its service and store arrows are counted per file,
 * which the page doesn't carry), the new parts' file boards (which files they draw, by
 * connections), and store boards that change (their readers are per file too). Boards whose own
 * boxes all exist in Default, with only their "elsewhere" boxes changed, are rolled up in the page.
 */
export function simpleStop(facts: Facts, model: Model, tree: SimpleTree): ModelSimple {
  const m = buildModel(facts, tree.grouping, tree.leafOf);
  const isNew = (id: string) => !!m.nodes[id] && !model.nodes[id];
  const nodes: ModelSimple["nodes"] = {}, boards: ModelSimple["boards"] = {};
  // a group's children get their parent from it in the page, so a node whose only change is its parent isn't shipped
  const sameBut = (a: ModelNode, b: ModelNode) => JSON.stringify({ ...a, parent: null }) === JSON.stringify({ ...b, parent: null });
  for (const id of Object.keys(m.nodes).sort()) if (!model.nodes[id] || !sameBut(model.nodes[id], m.nodes[id])) nodes[id] = m.nodes[id];
  for (const id of Object.keys(m.boards).sort()) {
    const b = m.boards[id];
    const ship = m.stores?.[id] ? differs(model.boards[id], b) : (isNew(id) && !m.nodes[id].children.length) || b.nodes.some((x) => isNew(x) && !b.context.includes(x));
    if (ship) boards[id] = b;
  }
  return { nodes, boards };
}
