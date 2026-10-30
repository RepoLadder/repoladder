// One board laid out by elkjs the way the build lays out with D2 (layout.ts), for boards the page
// lays out itself (the detail dial's stops, viewer/stoplayout.ts): the same box sizes, room for
// stacked cards and cylinders, the lane at the board's edge, wires ending on the drawn outlines, and
// the same pick among candidates (both directions at each gap, biggest names at fit). Pure: the
// caller runs the ELK graphs (in the page, a Worker; in Node, elkjs).
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { Model } from "../../model/rollup.ts";
import type { BoardLayout } from "../layout.ts";
import { bendsOnly, boardOf, edgeLabel, namePx, NAME_PX, partSizes, pickLayout } from "../boxsize.ts";
import { CYL_GAP, fitCylinders } from "../cylgap.ts";
import { LANE_IN, laneSides } from "../lane.ts";
import { STACK_PAD, isStacked, separateWires, snapWires } from "../outline.ts";
import { ELK_DEFAULTS, ELK_DIRS, ELK_GAPS, ELK_NODE_GAP, elkGraph, fromElk, type ElkOpts, type Graph } from "./elkgraph.ts";

export interface ElkCand {
  opts: ElkOpts;
  graph: Graph;
  /** Per box, the room added around what is drawn: [stacked cards right and down, cylinder height]. */
  room: Record<string, [number, number]>;
}

/**
 * The candidates for a group or file board, in the order the build tries them: tighter gaps first,
 * right before down at each. Lane boxes (lane.ts) take ELK partitions: senders before the parts,
 * receivers after them, so they hold the outermost layers as D2's "edge" lanes do.
 */
export function elkCandidates(model: Model, boardId: string): ElkCand[] {
  const b = boardOf(model, boardId), sides = laneSides(model, boardId);
  const size = partSizes(model, boardId, sides.size ? { mode: "edge" } : false);
  const part = sides.size ? Object.fromEntries([...sides].map(([id, s]) => [id, s === LANE_IN ? 0 : 2])) : undefined;
  const edges = b.edges.filter((e) => e.major).map((e) => ({ a: e.a, b: e.b, label: edgeLabel(e) }));
  const out: ElkCand[] = [];
  for (const gap of ELK_GAPS) for (const dir of ELK_DIRS) {
    // cylinders in a column want CYL_GAP between them (cylgap.ts), more than ELK's gap at tight spacing
    const cyl = Math.max(0, Math.ceil(CYL_GAP - ELK_NODE_GAP * gap));
    const room: ElkCand["room"] = {};
    const nodes = b.nodes.map((id) => {
      room[id] = [isStacked(model, boardId, id) ? STACK_PAD : 0, model.services[id] && dir === "right" ? cyl : 0];
      const [w, h] = size[id];
      return { id, w: w + room[id][0], h: h + room[id][0] + room[id][1], cyl: (model.services[id] ? 1 : 0) as 0 | 1 };
    });
    out.push({ opts: { dir, gap, ...ELK_DEFAULTS }, graph: { nodes, edges, ...(part ? { part } : {}) }, room });
  }
  return out;
}

export const candGraph = (c: ElkCand): ElkNode => elkGraph(c.graph, c.opts);

/** A candidate's ELK result as the viewer draws it: boxes at their own size, wires on their outlines. */
export function candLayout(model: Model, boardId: string, c: ElkCand, r: ElkNode): BoardLayout {
  const raw = fromElk(c.graph, r);
  const n = raw.n.map(([id, x, y, w, h, cyl]): BoardLayout["n"][number] => {
    const [stack, room] = c.room[id];
    return [id, x, y + Math.floor(room / 2), w - stack, h - stack - room, cyl];
  });
  const e = raw.e.map(([a, z, curve, ...p]): BoardLayout["e"][number] => [a, z, curve, ...bendsOnly(p)]);
  const padded = new Set(Object.keys(c.room).filter((id) => c.room[id][1]));
  return snapWires(model, boardId, separateWires(fitCylinders({ n, e }, padded)));
}

/**
 * Lays out a board with `run` (one ELK graph in, its layout out), candidate by candidate, and keeps
 * the one whose names read biggest at fit. Like the build, it stops once one fits at full size. A
 * direction is dropped once a wider gap reads smaller than the one before it: wider gaps only make
 * the board bigger, so its later gaps can't win (on a 477-file app, excalidraw and repoladder's Detailed
 * boards this keeps every winner of the full search and halves the work on the busy ones).
 */
export async function elkBoard(model: Model, boardId: string, run: (g: ElkNode) => Promise<ElkNode>): Promise<BoardLayout> {
  const done: BoardLayout[] = [], last = new Map<string, number>(), dropped = new Set<string>();
  for (const c of elkCandidates(model, boardId)) {
    if (dropped.has(c.opts.dir)) continue;
    const l = candLayout(model, boardId, c, await run(candGraph(c))), px = namePx(l);
    done.push(l);
    if (px >= NAME_PX) break;
    if (px < (last.get(c.opts.dir) ?? 0) - 0.01) dropped.add(c.opts.dir);
    last.set(c.opts.dir, px);
    if (dropped.size === ELK_DIRS.length) break;
  }
  return pickLayout(done);
}
