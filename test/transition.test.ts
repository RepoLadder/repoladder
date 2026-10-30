import { test } from "node:test";
import assert from "node:assert/strict";
import { contentRect, css, fit, plan, sharedIds } from "../src/viewer/transition.ts";
import { buildViewer } from "../src/build/viewer.ts";

// root ─ a ─ a1 ─ a1x
//      └ b
const parents: Record<string, string | null> = { root: null, a: "root", b: "root", a1: "a", a1x: "a1" };
const parent = (id: string) => parents[id];

test("transition plan: zoom into the box that leads down, out of the box we came from", () => {
  assert.deepEqual(plan("root", "a", parent), { kind: "in", via: "a" });
  assert.deepEqual(plan("a", "root", parent), { kind: "out", via: "a" });
  // jumps over levels (breadcrumbs, tours, deep links) zoom through the box one level down
  assert.deepEqual(plan("root", "a1x", parent), { kind: "in", via: "a" });
  assert.deepEqual(plan("a1x", "root", parent), { kind: "out", via: "a" });
  assert.deepEqual(plan("a1x", "a", parent), { kind: "out", via: "a1" });
  // unrelated boards and the same board crossfade
  assert.deepEqual(plan("a1", "b", parent), { kind: "fade" });
  assert.deepEqual(plan("a", "a", parent), { kind: "fade" });
  assert.deepEqual(plan("a", "ghost", parent), { kind: "fade" });
});

test("transition plan: boards that share boxes shuffle; zoom still wins; no count keeps the old answer", () => {
  assert.deepEqual(plan("_story", "root", parent, 5), { kind: "shuffle" });
  assert.deepEqual(plan("root", "_story", parent, 5), { kind: "shuffle" });
  assert.deepEqual(plan("a", "a", parent, 3), { kind: "shuffle" });
  assert.deepEqual(plan("a1", "b", parent, 4), { kind: "shuffle" });
  assert.deepEqual(plan("a1", "b", parent, 0), { kind: "fade" });
  assert.deepEqual(plan("a", "ghost", parent), { kind: "fade" });
  assert.deepEqual(plan("root", "a1x", parent, 9), { kind: "in", via: "a" });
  assert.deepEqual(plan("a1x", "a", parent, 9), { kind: "out", via: "a1" });
});

test("sharedIds keeps the ids on both boards, in the new board's order, once", () => {
  assert.deepEqual(sharedIds(["a", "b", "c"], ["c", "x", "a"]), ["c", "a"]);
  assert.deepEqual(sharedIds([], ["a"]), []);
  assert.deepEqual(sharedIds(["a"], []), []);
  assert.deepEqual(sharedIds(["a"], ["b"]), []);
  assert.deepEqual(sharedIds(["a", "a"], ["a", "a", "b"]), ["a"]);
});

test("transition geometry: fit centers one rect inside another; meet places the viewBox", () => {
  // a 100×50 box at (10,20) blown up to fill an 800×600 canvas: width-bound, scale 8, centered
  const t = fit({ x: 10, y: 20, w: 100, h: 50 }, { x: 0, y: 0, w: 800, h: 600 });
  assert.equal(t.s, 8);
  assert.equal(t.x, 400 - 8 * 60);
  assert.equal(t.y, 300 - 8 * 45);
  assert.equal(css({ s: 2, x: 3, y: 4 }), "translate(3px,4px) scale(2)");
  // a 200×100 viewBox in a 400×400 svg: scale 2, letterboxed top and bottom
  assert.deepEqual(contentRect([0, 0, 200, 100], 400, 400), { x: 0, y: 100, w: 400, h: 200, k: 2 });
});

test("the viewer bundle carries the transition and respects reduced motion", () => {
  const { js, css: sheet } = buildViewer();
  assert.ok(js.includes("prefers-reduced-motion"));
  assert.ok(sheet.includes("svg.ghost"));
});
