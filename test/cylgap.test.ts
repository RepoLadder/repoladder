// #131: cylinders stacked in a column keep a visible gap between one's bottom curve and the next one's lid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { drawnBoxes } from "../src/build/outline.ts";
import { lintBoard, lintModel } from "../src/build/lint.ts";
import { CYL_GAP, cylGap, cylPad, fitCylinders } from "../src/build/cylgap.ts";
import { ELK_GAP } from "../src/build/lane.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const build = (name: string): Model => {
  const facts = analyze(fixtures + name), g = Grouping.parse(defaultGrouping(facts));
  return buildModel(facts, g, assign(g, facts).leafOf);
};
const multi = build("multi");
type N = BoardLayout["n"][number];

test("cylPad: a cylinder gets room on right-flowing boards only, and only what the gap lacks", () => {
  assert.equal(cylPad(multi, "root", "svc-firebase-auth", "right", 4, false), Math.ceil(CYL_GAP - ELK_GAP / 4));
  assert.equal(cylPad(multi, "root", "svc-firebase-auth", "right", 1, false), CYL_GAP - ELK_GAP);
  assert.equal(cylPad(multi, "root", "svc-firebase-auth", "down", 4, false), 0);
  assert.equal(cylPad(multi, "root", "web", "right", 4, false), 0);
  // the cylGap option (LayoutOpts.cylGap) asks for another least gap
  assert.equal(cylPad(multi, "root", "svc-firebase-auth", "right", 1, false, 48), 48 - ELK_GAP);
});

test("cylGap: measured between the drawn outlines of stacked cylinders", () => {
  const n: N[] = [["svc-firebase-auth", 0, 0, 120, 80, 1], ["svc-stripe", 0, 85, 120, 80, 1], ["web", 400, 0, 160, 60, 0]];
  assert.equal(cylGap(drawnBoxes(multi, "root", n)), 5);
  assert.equal(lintBoard(multi, "root", { n, e: [] }).metrics.cylGap, 5);
  // side by side is not stacked
  assert.equal(cylGap(drawnBoxes(multi, "root", [["svc-firebase-auth", 0, 0, 120, 80, 1], ["svc-stripe", 200, 0, 120, 80, 1]])), null);
});

test("fitCylinders: a side wire that meets the room above or below the drawn cylinder moves onto its side", () => {
  const n: N[] = [["web", 0, 0, 100, 60, 0], ["svc-firebase-auth", 200, 20, 120, 80, 1]];
  // straight wire at y=24, above the side (lid rim at 20 + 9): it gets a step halfway
  const straight = fitCylinders({ n, e: [["web", "svc-firebase-auth", 0, 100, 24, 200, 24]] }, new Set(["svc-firebase-auth"]));
  assert.deepEqual(straight.e[0], ["web", "svc-firebase-auth", 0, 100, 24, 150, 24, 150, 33, 200, 33]);
  // a wire that comes down to it slides its last bend along
  const bent = fitCylinders({ n, e: [["web", "svc-firebase-auth", 0, 100, 30, 150, 30, 150, 98, 200, 98]] }, new Set(["svc-firebase-auth"]));
  assert.deepEqual(bent.e[0], ["web", "svc-firebase-auth", 0, 100, 30, 150, 30, 150, 87, 200, 87]);
  // one already on the side, and cylinders given no room, are left alone
  const ok: BoardLayout = { n, e: [["web", "svc-firebase-auth", 0, 100, 50, 200, 50]] };
  assert.deepEqual(fitCylinders(ok, new Set(["svc-firebase-auth"])).e, ok.e);
  assert.deepEqual(fitCylinders({ n, e: [["web", "svc-firebase-auth", 0, 100, 24, 200, 24]] }, new Set()).e[0], ["web", "svc-firebase-auth", 0, 100, 24, 200, 24]);
});

test("layout: stacked cylinders sit at least CYL_GAP apart, with no hard defects", async () => {
  const model = build("stores"), lints = lintModel(model, await layoutBoards(model));
  const stacked = lints.filter((l) => l.metrics.cylGap !== null);
  assert.ok(stacked.length > 0);
  for (const l of stacked) assert.ok(l.metrics.cylGap! >= CYL_GAP - 1, `${l.board}: ${l.metrics.cylGap}`);
  assert.deepEqual(lints.flatMap((l) => l.defects), []);
});
