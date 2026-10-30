// The layout/split loop of `build --default`: lay out, find boards whose names came out too small,
// split them once more (budgetsplit.ts), lay out again; up to two splits (#155). The passes share one
// D2 pool and reuse the layouts of boards the split left alone (layoutsession.ts).
import type { Model } from "../model/rollup.ts";
import type { Facts, Grouping } from "../model/schema.ts";
import { splitOverBudget } from "../model/budgetsplit.ts";
import { lintReport, type LintReport } from "./budget.ts";
import { newStats, formatStats, addStats, type LayoutStats } from "./layoutstats.ts";
import { layoutBoards, type BoardLayout } from "./layout.ts";
import { layoutSession, trackSession, type LayoutSession } from "./layoutsession.ts";
import { step, stepSync, type OnProgress } from "./progress.ts";
import { TIMINGS, timed, timedSync } from "./timings.ts";

export interface Passes { grouping: Grouping; model: Model; layout: Record<string, BoardLayout>; report: LintReport }

const MAX_SPLITS = 2;

export async function layoutPasses(o: {
  facts: Facts; grouping: Grouping;
  /** true for `--default`: crowded boards are split and laid out again */
  splitting: boolean;
  modelOf: (g: Grouping, first: boolean) => Model;
  cacheDir?: string; lane: boolean;
  onProgress?: OnProgress;
  /** summed over every pass; the layout timing line also reports it when timings are on */
  stats?: LayoutStats;
}): Promise<Passes> {
  let grouping = o.grouping, p = 0;
  const passes = o.splitting ? MAX_SPLITS + 1 : 1, on = o.onProgress;
  const at = (n: number) => ({ pass: n + 1, passes });
  let model = stepSync(on, { stage: "model", ...at(p) }, () => timedSync(`model#${p}`, () => o.modelOf(grouping, true)));
  // opened after the first model: a grouping that fails validation exits there, and must not rewrite the cache
  const session: LayoutSession = layoutSession({ cacheDir: o.cacheDir });
  const untrack = trackSession(session);
  const lay = (n: number, m: Model) => {
    const s0 = { ...session.stats }, p0 = { ...session.pool.stats };
    const total = Object.keys(m.boards).length + (m.story ? 1 : 0);
    const base = { stage: "layout", ...at(n), unit: "boards", total } as const;
    const onBoard = on && ((done: number, t: number) => on({ ...base, kind: "tick", done, total: t }));
    const stats = TIMINGS || o.stats ? newStats() : undefined;
    return step(on, base, async () => {
      const r = await timed(`layout#${n}`, () => layoutBoards(m, { session, lane: o.lane, onBoard, stats }), (r) =>
        `boards=${Object.keys(r).length} reused=${session.stats.reused - s0.reused} compiles=${session.pool.stats.misses - p0.misses} hits=${session.pool.stats.hits - p0.hits}${stats ? " " + formatStats(stats) : ""}`);
      if (stats && o.stats) addStats(o.stats, stats);
      return r;
    });
  };
  try {
    let layout = await lay(p, model);
    let report = stepSync(on, { stage: "lint", ...at(p) }, () => timedSync(`lint#${p}`, () => lintReport(model, layout, o.facts)));
    for (; o.splitting && p < MAX_SPLITS; p++) {
      const crowded = report.budget.byBoard.filter((b) => (b.kind === "files" || b.kind === "group") && b.over.some((r) => r.kind === "names")).map((b) => b.board);
      const next = crowded.length ? stepSync(on, { stage: "split", ...at(p) }, () => timedSync(`split#${p}`, () => splitOverBudget(grouping, o.facts, crowded))) : grouping;
      if (JSON.stringify(next) === JSON.stringify(grouping)) break;
      grouping = next;
      model = stepSync(on, { stage: "model", ...at(p + 1) }, () => timedSync(`model#${p + 1}`, () => o.modelOf(grouping, false)));
      layout = await lay(p + 1, model);
      report = stepSync(on, { stage: "lint", ...at(p + 1) }, () => timedSync(`lint#${p + 1}`, () => lintReport(model, layout, o.facts)));
    }
    return { grouping, model, layout, report };
  } finally {
    untrack();
    await session.close();
  }
}
