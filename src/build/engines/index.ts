// Layout engines behind one option (issue #75 spike). "d2" is production (layout.ts: D2's ELK with the
// direction and spread search). "elkjs" and "columns" lay out group and file boards themselves and
// leave the story level and store boards to D2 (graph.ts engineBoard). Each tries both directions at
// a few gap sizes and keeps the candidate whose names read biggest at fit, like D2's search.
import type { Model } from "../../model/rollup.ts";
import { layoutBoards, pickLayout, type BoardLayout } from "../layout.ts";
import { boardGraph, engineBoard, snapEnds } from "./graph.ts";
import { ELK_DEFAULTS, elkLayout, type ElkOpts } from "./elk.ts";
import { ELK_DIRS, ELK_GAPS } from "./elkgraph.ts";
import { columnLayout } from "./columns.ts";

export const ENGINES = ["d2", "elkjs", "columns"] as const;
export type LayoutEngine = (typeof ENGINES)[number];

export interface EngineOpts {
  dir?: "right" | "down";
  /** elkjs only: placement and ports (elk.ts). */
  elk?: Partial<Omit<ElkOpts, "dir" | "gap">>;
}

const COLUMN_GAPS: [number, number][] = [[48, 24], [72, 36], [110, 56], [160, 80]];

/** One board with a non-D2 engine: the best of its candidates. */
export async function engineLayout(model: Model, boardId: string, engine: Exclude<LayoutEngine, "d2">, o: EngineOpts = {}): Promise<BoardLayout> {
  const g = boardGraph(model, boardId), dirs = o.dir ? [o.dir] : ELK_DIRS;
  const cands: BoardLayout[] = [];
  for (const dir of dirs) {
    if (engine === "elkjs") for (const gap of ELK_GAPS) cands.push(await elkLayout(g, { dir, gap, ...ELK_DEFAULTS, ...o.elk }));
    else for (const [hgap, vgap] of COLUMN_GAPS) cands.push(columnLayout(g, { dir, hgap, vgap }));
  }
  return snapEnds(model, boardId, pickLayout(cands));
}

/** Every board with the chosen engine; D2 (and its cache) still does the boards the engine leaves to it. */
export async function layoutWith(model: Model, engine: LayoutEngine, opts: { cacheDir?: string } & EngineOpts = {}): Promise<Record<string, BoardLayout>> {
  const base = await layoutBoards(model, { cacheDir: opts.cacheDir });
  if (engine === "d2") return base;
  const out = { ...base };
  for (const id of Object.keys(base).sort()) if (engineBoard(model, id)) out[id] = await engineLayout(model, id, engine, opts);
  return out;
}
