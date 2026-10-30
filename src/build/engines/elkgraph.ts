// The ELK graph for one board and back: the options of the elkjs engine (elk.ts), without elkjs
// itself, so the page (viewer/stoplayout.ts) builds the same graphs and runs them in a Worker.
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { BoardLayout } from "../layout.ts";

export interface GNode { id: string; w: number; h: number; cyl: 0 | 1 }
export interface GEdge { a: string; b: string; label: string }
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  /**
   * Per box, its ELK partition: 0 before the parts, 1 the parts, 2 after them. The page's lanes
   * (build/lane.ts) hold the "elsewhere" boxes and services in their own outermost layer this way.
   */
  part?: Record<string, number>;
}

export interface ElkOpts {
  dir: "right" | "down";
  /** Multiplies every gap; 1 is ELK's spacing at our box sizes. */
  gap: number;
  /** BK: Brandes–Köpf with balanced alignment (straight runs, boxes lined up); NS: network simplex. */
  placement: "BK" | "NS";
  /** Each wire on its own port on a fixed side: out on the flow side, in on the opposite one. */
  ports: boolean;
  /** Keep the grouping's order of boxes and edges where crossings allow (considerModelOrder). */
  modelOrder: boolean;
}

export const ELK_DEFAULTS: Omit<ElkOpts, "dir" | "gap"> = { placement: "NS", ports: false, modelOrder: true };
/** The candidates the engine tries per board: both directions at each gap, best name size at fit wins. */
export const ELK_DIRS = ["right", "down"] as const;
export const ELK_GAPS = [0.6, 1, 1.5, 2.2];
/** ELK's gap between boxes in a layer at `gap` 1 (elk.spacing.nodeNode). */
export const ELK_NODE_GAP = 40;

/** Rough size of an edge label as the viewer draws it (11px mono pill), for engines that reserve room. */
export const labelSize = (s: string): [number, number] => [Math.ceil(s.length * 6.7 + 14), 18];

/**
 * The ELK graph at ELK_DEFAULTS (network simplex, free ports, model order), the only options the
 * page and the build use; elk.ts turns it into the other variants scripts/engines.ts compares.
 */
export function elkGraph(g: Graph, o: Pick<ElkOpts, "dir" | "gap">): ElkNode {
  const R = o.dir === "right";
  const gap = (n: number) => String(Math.round(n * o.gap));
  const part = (id: string): Record<string, string> => (g.part ? { "elk.partitioning.partition": String(g.part[id] ?? 1) } : {});
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": R ? "RIGHT" : "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      // keep the grouping's order where the crossing count allows it: deterministic, and close to what D2 does
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
      "elk.spacing.nodeNode": gap(ELK_NODE_GAP),
      "elk.layered.spacing.nodeNodeBetweenLayers": gap(70),
      "elk.spacing.edgeNode": gap(20),
      "elk.spacing.edgeEdge": gap(12),
      "elk.layered.spacing.edgeNodeBetweenLayers": gap(24),
      "elk.layered.spacing.edgeEdgeBetweenLayers": gap(12),
      "elk.edgeLabels.inline": "false",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
      ...(g.part ? { "elk.partitioning.activate": "true" } : {}),
    },
    children: g.nodes.map((n) => ({
      id: n.id, width: n.w, height: n.h,
      ...(g.part ? { layoutOptions: part(n.id) } : {}),
    })),
    edges: g.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.a], targets: [e.b],
      labels: e.label ? [{ text: e.label, width: labelSize(e.label)[0], height: labelSize(e.label)[1] }] : [],
    })),
  };
}

/** ELK's answer for `elkGraph(g, …)` in the BoardLayout shape D2's layouts use, rounded to 0.1. */
export function fromElk(g: Graph, r: ElkNode): BoardLayout {
  const R = (v: number) => Math.round(v * 10) / 10;
  const cyl = new Map(g.nodes.map((n) => [n.id, n.cyl]));
  return {
    n: (r.children ?? []).map((c) => [c.id, R(c.x!), R(c.y!), R(c.width!), R(c.height!), cyl.get(c.id)!]),
    e: (r.edges ?? []).map((e) => {
      const s = e.sections![0], pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint], src = g.edges[Number(e.id.slice(1))];
      return [src.a, src.b, 0, ...pts.flatMap((p) => [R(p.x), R(p.y)])];
    }),
  };
}
