// What every layout engine starts from: a board's boxes at their final sizes and its major edges.
// D2 gets the same boxes and edges as source text (layout.ts); the engines here take them as data.
import type { Model } from "../../model/rollup.ts";
import { STORY } from "../../viewer/state.ts";
import { boardOf, boxSizes, edgeLabel, type BoardLayout } from "../layout.ts";
import { isStoreBoard } from "../storelayout.ts";
import { drawnBoxes, signedDist, type Pt } from "../outline.ts";

import type { Graph } from "./elkgraph.ts";

export { labelSize, type GEdge, type GNode, type Graph } from "./elkgraph.ts";

/**
 * The engines here lay out group and file boards. The story level (actors in a column, a lane of
 * sentences) and store boards (collections nested in containers) lean on D2 containers, so they stay on D2.
 */
export const engineBoard = (model: Model, boardId: string) => boardId !== STORY && !isStoreBoard(model, boardId);

export function boardGraph(model: Model, boardId: string): Graph {
  const b = boardOf(model, boardId), size = boxSizes(model, boardId);
  return {
    nodes: b.nodes.map((id) => ({ id, w: size[id][0], h: size[id][1], cyl: model.services[id] ? 1 : 0 })),
    edges: b.edges.filter((e) => e.major).map((e) => ({ a: e.a, b: e.b, label: edgeLabel(e) })),
  };
}

/**
 * Moves each arrowhead onto the box as drawn (outline.ts): engines end wires on the laid-out rectangle,
 * but a cylinder's lid curves away from it and an openable part's stacked cards stick out past it.
 * The last segment is shortened or extended along its own line to the first point that touches.
 */
export function snapEnds(model: Model, boardId: string, layout: BoardLayout): BoardLayout {
  const parts = new Map(drawnBoxes(model, boardId, layout.n).map((d) => [d.id, d.parts]));
  const e = layout.e.map(([a, b, curve, ...p]): BoardLayout["e"][number] => {
    const target = parts.get(b);
    if (curve || !target || p.length < 4) return [a, b, curve, ...p];
    const n = p.length, from: Pt = [p[n - 4], p[n - 3]], to: Pt = [p[n - 2], p[n - 1]];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (!len) return [a, b, curve, ...p];
    const u: Pt = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
    const at = (t: number): Pt => [from[0] + u[0] * t, from[1] + u[1] * t];
    // walk from the bend toward (and past) the box until the wire is inside the drawing, then bisect
    const end = len + 24;
    let hi = -1;
    for (let t = 0; t <= end; t += 1) if (signedDist(at(t), target) <= 0) { hi = t; break; }
    if (hi <= 0) return [a, b, curve, ...p];
    let lo = hi - 1;
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (signedDist(at(m), target) <= 0) hi = m; else lo = m; }
    const q = at(hi);
    return [a, b, curve, ...p.slice(0, n - 2), Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10];
  });
  return { n: layout.n, e };
}
