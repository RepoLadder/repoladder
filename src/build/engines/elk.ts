// Layout through elkjs directly, rather than through D2's ELK. D2 passes ELK only a handful of
// options; here we choose node placement, model order, port sides and spacing ourselves.
// The graph and its options are in elkgraph.ts, which the page shares (viewer/stoplayout.ts).
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";

// a CommonJS module: under Node's ESM loader its default export is the constructor itself
const ELK = bundled as unknown as new () => ElkApi;
import type { BoardLayout } from "../layout.ts";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { elkGraph, fromElk, type ElkOpts, type Graph } from "./elkgraph.ts";

export { ELK_DEFAULTS, elkGraph, type ElkOpts } from "./elkgraph.ts";

let elk: ElkApi | null = null;

/** One elkjs layout of a board, in the BoardLayout shape D2's layouts use. Unsnapped: see graph.ts snapEnds. */
export async function elkLayout(g: Graph, o: ElkOpts): Promise<BoardLayout> {
  elk ??= new ELK();
  return fromElk(g, await elk.layout(variantGraph(g, o)));
}

/** elkGraph with the options only scripts/engines.ts tries: Brandes–Köpf placement, no model order, each wire on its own port on a fixed side. */
export function variantGraph(g: Graph, o: ElkOpts): ElkNode {
  const r = elkGraph(g, o), lo = r.layoutOptions!;
  if (o.placement === "BK") lo["elk.layered.nodePlacement.strategy"] = "BRANDES_KOEPF";
  if (!o.modelOrder) Object.assign(lo, { "elk.layered.considerModelOrder.strategy": "NONE", "elk.layered.cycleBreaking.strategy": "GREEDY" });
  if (!o.ports) return r;
  // out on the flow side, in on the opposite one
  const [out, inn] = o.dir === "right" ? ["EAST", "WEST"] : ["SOUTH", "NORTH"];
  r.children = r.children!.map((c) => ({
    ...c,
    layoutOptions: { "elk.portConstraints": "FIXED_SIDE", ...c.layoutOptions },
    ports: g.edges.flatMap((e, i) => [
      ...(e.a === c.id ? [{ id: `o${i}`, layoutOptions: { "elk.port.side": out } }] : []),
      ...(e.b === c.id ? [{ id: `i${i}`, layoutOptions: { "elk.port.side": inn } }] : []),
    ]),
  }));
  r.edges = r.edges!.map((e, i) => ({ ...e, sources: [`o${i}`], targets: [`i${i}`] }));
  return r;
}
