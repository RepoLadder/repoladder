// #311: the layout/split loop of `build --default` shares one D2 pool and reuses unchanged boards.
// Its result must be what the old loop (a fresh layoutBoards per pass) gave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintReport } from "../src/build/budget.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { layoutSession } from "../src/build/layoutsession.ts";
import { layoutPasses } from "../src/build/passes.ts";
import type { ProgressEvent } from "../src/build/progress.ts";
import { splitOverBudget } from "../src/model/budgetsplit.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import type { Facts, GroupNode, Grouping } from "../src/model/schema.ts";

const facts = (files: string[]): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const leaf = (id: string, ...files: string[]): GroupNode => ({ id, name: id, summary: "", files });
const grouping = (...children: GroupNode[]): Grouping => ({ version: 1, summary: "t", children });

// "feat" is a leaf of 15 files: a file board whose names come out too small, so the split pass opens it
const files = [...["a", "b", "c"].flatMap((d) => Array.from({ length: 5 }, (_, i) => `src/feat/${d}/f${d}${i}.ts`)), "src/x/x1.ts", "src/y/y1.ts", "src/z/z1.ts"];
const f = facts(files);
const start = grouping(leaf("feat", "src/feat/**"), leaf("x", "src/x/**"), leaf("y", "src/y/**"), leaf("z", "src/z/**"));
const modelOf = (g: Grouping): Model => buildModel(f, g, assign(g, f).leafOf);

/** The loop as cli.ts ran it before #311. */
async function oldLoop() {
  let grouping = start, model = modelOf(grouping), layout = await layoutBoards(model), report = lintReport(model, layout, f);
  for (let i = 0; i < 2; i++) {
    const crowded = report.budget.byBoard.filter((b) => (b.kind === "files" || b.kind === "group") && b.over.some((r) => r.kind === "names")).map((b) => b.board);
    const next = crowded.length ? splitOverBudget(grouping, f, crowded) : grouping;
    if (JSON.stringify(next) === JSON.stringify(grouping)) break;
    grouping = next;
    model = modelOf(grouping);
    layout = await layoutBoards(model);
    report = lintReport(model, layout, f);
  }
  return { grouping, model, layout, report };
}

const run = (extra: Partial<Parameters<typeof layoutPasses>[0]> = {}) => layoutPasses({ facts: f, grouping: start, splitting: true, modelOf: (g) => modelOf(g), lane: true, ...extra });

test("layout passes: same grouping, model, layout and report as the old loop", async () => {
  const [old, now] = [await oldLoop(), await run()];
  assert.notDeepEqual(now.grouping, start, "the fixture must make the split pass change the grouping");
  assert.equal(JSON.stringify(now), JSON.stringify(old));
});

test("layout passes: boards the split left alone are reused, and equal a fresh layout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-passes-"));
  try {
    const now = await run({ cacheDir: dir });
    const fresh = await layoutBoards(now.model);
    assert.equal(JSON.stringify(now.layout), JSON.stringify(fresh));
    // a session over the same two passes: pass 2 reuses the untouched boards (root, x, y, z are not feat's)
    const session = layoutSession();
    try {
      const m0 = modelOf(start), m1 = now.model;
      await layoutBoards(m0, { session });
      const before = session.stats.reused;
      const second = await layoutBoards(m1, { session });
      assert.ok(session.stats.reused > before, "pass 2 reused nothing");
      for (const id of Object.keys(second)) assert.deepEqual(second[id], fresh[id]);
    } finally {
      await session.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("layout passes: verify mode checks every reuse against a fresh layout without throwing", async () => {
  process.env.REPOLADDER_VERIFY_LAYOUT = "1";
  try {
    const now = await run();
    assert.equal(JSON.stringify(now), JSON.stringify(await oldLoop()));
  } finally {
    delete process.env.REPOLADDER_VERIFY_LAYOUT;
  }
});

test("layout session: two models in one session save the union, and a fresh session compiles nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-session-"));
  try {
    const model = modelOf(start), split = splitOverBudget(start, f, ["feat"]);
    assert.notDeepEqual(split, start, "the split must change the grouping");
    const modelB = modelOf(split);
    const keys = async (models: Model[], sub: string) => {
      const d = join(dir, sub), s = layoutSession({ cacheDir: d });
      for (const m of models) await layoutBoards(m, { session: s });
      await s.close();
      return new Set(Object.keys(JSON.parse(readFileSync(join(d, "layout-cache.json"), "utf8")).entries));
    };
    const both = await keys([model, modelB], "both"), a = await keys([model], "a"), b = await keys([modelB], "b");
    for (const k of [...a, ...b]) assert.ok(both.has(k));
    const warm = layoutSession({ cacheDir: join(dir, "both") });
    try {
      await layoutBoards(model, { session: warm });
      await layoutBoards(modelB, { session: warm });
      assert.equal(warm.pool.stats.misses, 0);
    } finally {
      await warm.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("layout passes: a model that fails to build leaves the cache file alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-passes-"));
  try {
    await run({ cacheDir: dir });
    const file = join(dir, "layout-cache.json"), before = readFileSync(file, "utf8");
    await assert.rejects(run({ cacheDir: dir, modelOf: () => { throw new Error("INVALID grouping"); } }), /INVALID grouping/);
    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("progress: layoutBoards calls onBoard once per board and onProgress changes no result", async () => {
  const model = modelOf(start);
  const seen: [number, number][] = [];
  const plain = await layoutBoards(model);
  const withCb = await layoutBoards(model, { onBoard: (d, t) => seen.push([d, t]) });
  const total = Object.keys(model.boards).length + (model.story ? 1 : 0);
  assert.equal(seen.length, total);
  assert.deepEqual(seen.map((s) => s[0]), Array.from({ length: total }, (_, i) => i + 1));
  assert.ok(seen.every((s) => s[1] === total));
  assert.deepEqual(withCb, plain);
});

test("progress: layoutPasses emits layout start, ticks and done per pass with pass numbers", async () => {
  for (const splitting of [false, true]) {
    const events: ProgressEvent[] = [];
    const args = { facts: f, grouping: start, splitting, modelOf: (g: Grouping) => modelOf(g), lane: true };
    const a = await layoutPasses({ ...args, onProgress: (e) => events.push(e) });
    const b = await layoutPasses(args);
    assert.deepEqual(a.layout, b.layout);
    assert.deepEqual(a.grouping, b.grouping);
    const lay = events.filter((e) => e.stage === "layout");
    assert.ok(lay.length >= 3);
    assert.ok(lay.every((e) => e.passes === (splitting ? 3 : 1)));
    assert.equal(lay.filter((e) => e.kind === "start").length, lay.filter((e) => e.kind === "done").length);
    assert.ok(lay.some((e) => e.kind === "tick" && e.pass === 1));
    assert.equal(lay[0].kind, "start");
    assert.equal(lay.at(-1)!.kind, "done");
  }
});
