// #433: the board concurrency cap and the candidate dedupe must not change a layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inFlight, layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { pickLayout } from "../src/build/boxsize.ts";
import { dedupe } from "../src/build/layoutstats.ts";
import { layoutPasses } from "../src/build/passes.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { syntheticFacts } from "../scripts/layoutbenchrepo.ts";

const f = syntheticFacts({ folders: 25, seed: 7 }), g = defaultGrouping(f);
const modelOf = (x: typeof g) => buildModel(f, x, assign(x, f).leafOf);

test("board cap: one board at a time and the default give identical layouts, in the same order", async () => {
  const m = modelOf(g);
  const [one, def] = [await layoutBoards(m, { maxBoards: 1 }), await layoutBoards(m)];
  assert.deepEqual(Object.keys(one), Object.keys(def));
  assert.equal(JSON.stringify(one), JSON.stringify(def));
});

test("board cap: layoutPasses (and verify mode) are unaffected", async () => {
  const run = () => layoutPasses({ facts: f, grouping: g, splitting: true, lane: true, modelOf });
  const a = await run();
  process.env.REPOLADDER_VERIFY_LAYOUT = "1";
  try {
    assert.equal(JSON.stringify(await run()), JSON.stringify(a));
  } finally {
    delete process.env.REPOLADDER_VERIFY_LAYOUT;
  }
});

test("inFlight: never exceeds the cap and keeps the item order", async () => {
  let live = 0, peak = 0;
  const out = await inFlight([5, 1, 4, 2, 3, 0], 2, async (x) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, x));
    live--;
    return x * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.ok(peak <= 2);
  assert.deepEqual(await inFlight([], 4, async (x) => x), []);
});

test("inFlight: starts nothing new after a failure", async () => {
  const started: number[] = [];
  await assert.rejects(inFlight([0, 1, 2, 3, 4, 5, 6, 7], 2, async (x) => {
    started.push(x);
    await new Promise((r) => setTimeout(r, 1));
    if (x === 1) throw new Error("boom");
  }), /boom/);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(started.length < 8, `started ${started.length}`);
});

test("dedupe: the pick is the same with and without dropping equal candidates", () => {
  const box = (w: number): BoardLayout => ({ n: [["a", 0, 0, w, 40, 0], ["b", 100, 0, w, 40, 0]], e: [["a", "b", 0, w, 20, 100, 20]] });
  const wide = box(300), tie = box(120);
  const cands = [wide, structuredClone(wide), tie, structuredClone(tie), structuredClone(wide)];
  const { kept, dropped } = dedupe(cands, new Set());
  assert.equal(dropped, 3);
  assert.equal(JSON.stringify(pickLayout(kept)), JSON.stringify(pickLayout(cands)));
  // ties still pick the first of the equals
  const a = box(150), b = structuredClone(a);
  assert.equal(pickLayout([a, b]), a);
});
