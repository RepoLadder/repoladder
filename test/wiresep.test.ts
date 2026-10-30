// Wires drawn on top of each other (#497): the detector, the pass that gives them tracks, and the lint metric.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import type { BoardLayout } from "../src/build/layout.ts";
import { overlapPairs, separateWires, sharedRuns } from "../src/build/outline.ts";
import { lintBoard } from "../src/build/lint.ts";
import { pickLayout } from "../src/build/boxsize.ts";

type E = BoardLayout["e"][number];
const h = (a: string, z: string, y: number, x0: number, x1: number, curve: 0 | 1 = 0): E => [a, z, curve, x0, y, x1, y];

test("sharedRuns: same line, shared length over 4px", () => {
  const runs = sharedRuns({ e: [h("a", "z", 50, 0, 100), h("b", "z", 50, 40, 140)] });
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].wires, [0, 1]);
});

test("sharedRuns: touching at a point, parallel 10px apart and curves are not runs", () => {
  assert.equal(sharedRuns({ e: [h("a", "z", 50, 0, 100), h("b", "z", 50, 100, 200)] }).length, 0);
  assert.equal(sharedRuns({ e: [h("a", "z", 50, 0, 100), h("b", "z", 60, 0, 100)] }).length, 0);
  assert.equal(sharedRuns({ e: [h("a", "z", 50, 0, 100), h("b", "z", 50, 0, 100, 1)] }).length, 0);
});

// five boxes at different heights, wires run down one corridor at x=300 and enter the box "t" on its left side
const boxes = (): BoardLayout["n"] => [
  ...[0, 1, 2, 3, 4].map((i): BoardLayout["n"][number] => [`s${i}`, 0, i * 120, 100, 60, 0]),
  ["t", 400, 0, 120, 300, 0],
];
const bundle = (): BoardLayout["e"] => [0, 1, 2, 3, 4].map((i): E => [`s${i}`, "t", 0, 100, i * 120 + 30, 300, i * 120 + 30, 300, 150, 400, 150]);
const crossings = (l: BoardLayout) => lintBoard(multiModel, "root", l).metrics.crossings;

const multiModel = (() => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  const g = Grouping.parse(defaultGrouping(facts));
  return buildModel(facts, g, assign(g, facts).leafOf);
})();

test("separateWires: a bundle in one corridor gets its own tracks, stays orthogonal and on the box side", () => {
  const before: BoardLayout = { n: boxes(), e: bundle() };
  assert.ok(sharedRuns(before).length > 0);
  const after = separateWires(before);
  assert.equal(sharedRuns(after).length, 0);
  for (const [, , , ...p] of after.e) for (let i = 2; i + 1 < p.length; i += 2) assert.ok(p[i] === p[i - 2] || p[i + 1] === p[i - 1], "orthogonal");
  for (const [, , , ...p] of after.e) assert.ok(p[p.length - 2] === 400 && p[p.length - 1] >= 6 && p[p.length - 1] <= 294, "end on the box side");
  assert.ok(crossings(after) <= crossings(before));
  const bad = lintBoard(multiModel, "root", after).defects.filter((d) => d.kind === "through");
  assert.deepEqual(bad, [], "no wire passes through a box");
});

test("separateWires: a box side too short for the shift leaves the layout unchanged", () => {
  const n: BoardLayout["n"] = [["a", 0, 0, 100, 20, 0], ["b", 0, 40, 100, 20, 0], ["t", 400, 0, 20, 16, 0]];
  const l: BoardLayout = { n, e: [["a", "t", 0, 100, 10, 300, 10, 300, 8, 400, 8], ["b", "t", 0, 100, 50, 300, 50, 300, 8, 400, 8]] };
  assert.equal(separateWires(l), l);
});

test("sharedRuns: a curve in a pair with a real run is ignored, a wire ending on another's line is not a run", () => {
  assert.equal(sharedRuns({ e: [h("a", "z", 50, 0, 100), h("b", "z", 50, 40, 140), h("c", "z", 50, 0, 140, 1)] })[0].wires.length, 2);
  assert.equal(sharedRuns({ e: [h("a", "z", 50, 0, 100), ["b", "z", 0, 98, 0, 98, 50]] }).length, 0);
});

test("separateWires: no runs returns the same layout", () => {
  const l: BoardLayout = { n: boxes(), e: [h("s0", "t", 30, 100, 400)] };
  assert.equal(separateWires(l), l);
});

test("lint: overlapWires counts overlapping pairs and drops to 0 once separated", () => {
  const l: BoardLayout = { n: boxes(), e: bundle() };
  const lint = (x: BoardLayout) => lintBoard(multiModel, "root", x).metrics.overlapWires;
  assert.ok(lint(l) > 0);
  assert.equal(lint(separateWires(l)), 0);
});

test("pickLayout: fewer overlapping wires beats bigger names", () => {
  const small: BoardLayout = { n: [["a", 0, 0, 100, 60, 0], ["t", 3000, 0, 100, 60, 0]], e: [h("a", "t", 30, 100, 3000), h("a", "t", 30, 100, 3000)] };
  const clean: BoardLayout = { n: [["a", 0, 0, 100, 60, 0], ["t", 3000, 0, 100, 60, 0]], e: [h("a", "t", 30, 100, 3000), h("a", "t", 40, 100, 3000)] };
  const tight: BoardLayout = { n: [["a", 0, 0, 100, 60, 0], ["t", 300, 0, 100, 60, 0]], e: [h("a", "t", 30, 100, 300), h("a", "t", 30, 100, 300)] };
  assert.equal(pickLayout([tight, clean]), clean);
  assert.equal(overlapPairs(small), 1);
});
