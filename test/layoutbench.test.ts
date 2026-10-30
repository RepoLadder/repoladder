import { test } from "node:test";
import assert from "node:assert/strict";
import { syntheticFacts } from "../scripts/layoutbenchrepo.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";

test("syntheticFacts: deterministic, and the seed changes it", () => {
  const a = syntheticFacts({ folders: 40, seed: 3 });
  assert.deepEqual(a, syntheticFacts({ folders: 40, seed: 3 }));
  assert.notDeepEqual(a.files, syntheticFacts({ folders: 40, seed: 4 }).files);
  assert.deepEqual(a.files.map((f) => f.path), a.files.map((f) => f.path).sort());
});

test("syntheticFacts: builds through the default grouping into many boards", () => {
  const f = syntheticFacts({ folders: 80 }), g = defaultGrouping(f);
  const model = buildModel(f, g, assign(g, f).leafOf);
  assert.ok(Object.keys(model.boards).length > 100, `${Object.keys(model.boards).length} boards`);
});
