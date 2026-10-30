import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { d2Source, edgeLabel } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type ModelEdge } from "../src/model/rollup.ts";
import { countTiles, edgeCounts } from "../src/viewer/counts.ts";
import { wireLabel } from "../src/viewer/state.ts";

const edge = (x: Partial<Omit<ModelEdge, "ev">>) => ({ a: "a", b: "b", imports: 0, calls: 0, uses: 0, major: true, ev: [] as never[], ...x });

test("arrows carry no counts: only store verbs and story verbs are drawn", () => {
  assert.equal(edgeLabel(edge({ imports: 18, calls: 2 })), "");
  assert.equal(edgeLabel(edge({ calls: 3 })), "");
  assert.equal(edgeLabel(edge({ reads: 2 })), "reads");
  assert.equal(wireLabel(edge({ imports: 18 })), "");
  assert.equal(wireLabel(edge({ writes: 1 })), "writes");
  assert.equal(wireLabel(edge({ says: ["checks in", "pays"] })), "checks in · pays");
});

test("group-board D2 sources reserve no label room for import or call arrows", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  const g = defaultGrouping(facts), model = buildModel(facts, g, assign(g, facts).leafOf);
  const arrows = d2Source(model, "root").split("\n").filter((l) => l.includes(" -> "));
  assert.ok(arrows.length);
  for (const l of arrows) assert.doesNotMatch(l, /: "/, l);
});

test("the connection panel lists every nonzero count, singular or plural", () => {
  assert.deepEqual(edgeCounts(edge({ imports: 18, calls: 1 })), [[18, "imports"], [1, "call by name"]]);
  assert.deepEqual(edgeCounts(edge({ reads: 3, writes: 1, uses: 9 })), [[3, "reads"], [1, "write"]], "a store arrow counts data, not SDK imports");
  assert.deepEqual(edgeCounts(edge({ uses: 2 })), [[2, "SDK imports"]]);
  assert.equal(countTiles(edge({})), "");
  assert.match(countTiles(edge({ imports: 1200 })), /<b>1,200<\/b><span>imports<\/span>/);
});
