// Chain tours (docs/tours-v2.md): the grouping names a chain of files and captions; composeTour
// works out the boards and stops. This turns its ChainErrors into INVALID tours lines Claude can act on.
import { ChainError, composeTour, type TourGraph } from "./compose.ts";
import { FILE, filePath } from "./fileboards.ts";
import { fileRef, indexOf, isSink } from "./tourgraph.ts";
import type { Board, Model } from "./rollup.ts";
import type { ChainTour } from "./schema.ts";
import type { ModelTour } from "./tours.ts";

/**
 * The tour graph of a built model, in page-data form (docs/tours-data.md): file boxes "@<index>"
 * into `paths`. Steps come back in those ids; `fromGraph` turns them into the model's "f:<path>".
 */
export function tourGraph(model: Model): TourGraph {
  const paths = [...new Set(Object.values(model.nodes).flatMap((n) => n.files))].sort();
  const at = new Map(paths.map((p, i) => [p, i]));
  const pid = (id: string) => (id.startsWith(FILE) ? `@${at.get(filePath(id))}` : id);
  const board = (b: Board) => ({ nodes: b.nodes.map(pid), context: b.context.map(pid), edges: b.edges.map((e) => ({ ...e, a: pid(e.a), b: pid(e.b) })) });
  return {
    paths,
    nodes: Object.fromEntries(Object.entries(model.nodes).map(([id, n]) => [id, { ...n, files: n.files.map((f) => at.get(f)!) }])),
    boards: Object.fromEntries(Object.entries(model.boards).map(([id, b]) => [id, board(b)])),
    fgraph: (model.fgraph ?? []).map(([a, b, ...r]) => [at.get(a) ?? a, at.get(b) ?? b, ...r]),
    services: model.services,
  };
}

const fromGraph = (g: TourGraph, id: string) => (id[0] === "@" ? FILE + g.paths[Number(id.slice(1))] : id);

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tour";

/** Files that might be meant by a path that isn't on any board: the same file name elsewhere. */
function nearest(g: TourGraph, f: string): string[] {
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  return g.paths.filter((p) => name(p) === name(f)).slice(0, 3);
}

/** Compose one chain tour; `at` prefixes its error lines. */
export function resolveChainTour(t: ChainTour, id: string, g: TourGraph, at: string): { tour?: ModelTour; errors: string[]; warnings: string[] } {
  const last = t.chain[t.chain.length - 1];
  const hops = t.chain.length - 1;
  if (t.captions && t.captions.length !== hops) return { warnings: [], errors: [`${at}: ${t.captions.length} captions for ${hops} hop${hops === 1 ? "" : "s"} (one per hop: chain[i] -> chain[i+1])`] };
  // unknown files first, so the message can say which entry and guess the path meant
  const ix = indexOf(g);
  for (const [i, f] of t.chain.entries()) {
    if (i === t.chain.length - 1 && isSink(f)) continue;
    if (fileRef(ix, f) !== undefined) continue;
    const near = isSink(f) ? [] : nearest(g, f);
    const why = isSink(f) ? "a service or store may only end a chain" : `use repo paths as the digest prints them${near.length ? `; did you mean ${near.map((p) => `"${p}"`).join(", ")}?` : ""}`;
    return { warnings: [], errors: [`${at}: chain[${i}] "${f}" is not a source file on any board (${why})`] };
  }
  let steps;
  const warnings: string[] = [];
  try {
    steps = composeTour(g, t.chain, {
      depth: t.depth, captions: t.captions,
      onFallback: ({ hop: [x, y], board }) => warnings.push(`${at}: hop ${t.chain.findIndex((f, i) => f === x && t.chain[i + 1] === y) + 1}: ${x} -> ${y} is listed on board "${board}" but no board draws it as an arrow (minor, or into a service used throughout)`),
    });
  } catch (e) {
    if (!(e instanceof ChainError)) throw e;
    if (!e.hop) return { warnings: [], errors: [`${at}: ${e.message}`] };
    const [a, b] = e.hop;
    const n = t.chain.findIndex((f, i) => f === a && t.chain[i + 1] === b) + 1;
    const what = isSink(b) && b === last
      ? `${a} does not use ${b} (end the chain at a file that does, or drop the ${b.startsWith("svc-") ? "service" : "store"})`
      : e.reversed
        ? `no import or call ${a} -> ${b} (there is one ${b} -> ${a}; a chain points from the code that imports or calls, so swap them or walk the other way)`
        : e.message.includes("not drawn") ? `${a} -> ${b} is not drawn on any board (a file there may be hidden under "+N more")` : `no import or call ${a} -> ${b}`;
    return { warnings: [], errors: [`${at}: hop ${n || "?"}: ${what}`] };
  }
  return {
    errors: [], warnings,
    tour: {
      id, title: t.title, source: "claude",
      steps: steps.map((s) => {
        const edges = s.lit.edges.map(([x, y]): [string, string] => [fromGraph(g, x), fromGraph(g, y)]);
        // `edge` keeps the steps form's shape for players that read only it
        return { text: s.caption, board: s.board, edge: edges[0], stop: s.stop, lit: { boxes: s.lit.boxes.map((x) => fromGraph(g, x)), edges }, ...(s.via ? { via: s.via } : {}) };
      }),
    },
  };
}
