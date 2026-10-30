// Layout cost benchmark: builds a synthetic many-small-boards repo through the default grouping and the
// layout/split passes, offline and cold, and prints the board, compile and hit counts, the wall time and
// the layout stats. `npm run bench:layout -- [--folders N] [--seed N] [--workers N] [--cache-dir DIR]`.
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const num = (name: string, d: number) => (arg(name) === undefined ? d : Number(arg(name)));
// per-pass boards/reused/compiles/hits come from the TIMING lines (read at import, so set before the imports below)
process.env.REPOLADDER_TIMINGS = "1";
if (arg("workers")) process.env.REPOLADDER_D2_WORKERS = arg("workers");

const { defaultGrouping, assign } = await import("../src/model/grouping.ts");
const { buildModel } = await import("../src/model/rollup.ts");
const { layoutPasses } = await import("../src/build/passes.ts");
const { formatStats, newStats } = await import("../src/build/layoutstats.ts");
const { syntheticFacts } = await import("./layoutbenchrepo.ts");

const facts = syntheticFacts({ folders: num("folders", 300), seed: num("seed", 1) });
const grouping = defaultGrouping(facts);
const stats = newStats();
const t0 = performance.now();
const out = await layoutPasses({
  facts, grouping, splitting: true, lane: true, cacheDir: arg("cache-dir"), stats,
  modelOf: (g) => buildModel(facts, g, assign(g, facts).leafOf),
});
const ms = performance.now() - t0;
const requests = Object.values(stats.dir).reduce((a, b) => a + b, 0);
console.log(`files=${facts.files.length} boards=${Object.keys(out.layout).length} compileRequests=${requests} wall=${(ms / 1000).toFixed(1)}s`);
console.log(formatStats(stats));
