import { test } from "node:test";
import assert from "node:assert/strict";
import { clippedSides, syncEdgeCue } from "../src/viewer/edgecue.ts";

const none = { l: false, r: false, t: false, b: false };
const V = [0, 0, 390, 844];

test("a box cut by the right edge clips right only", () => {
  assert.deepEqual(clippedSides(V, 390, 844, [[300, 100, 200, 50]]), { ...none, r: true });
});
test("a box fully right of the canvas clips right", () => {
  assert.deepEqual(clippedSides(V, 390, 844, [[600, 100, 100, 50]]), { ...none, r: true });
});
test("a 2px overhang is under the threshold", () => {
  assert.deepEqual(clippedSides(V, 390, 844, [[300, 100, 92, 50]]), none);
});
test("left, top and bottom", () => {
  assert.deepEqual(clippedSides(V, 390, 844, [[-50, 100, 100, 50]]), { ...none, l: true });
  assert.deepEqual(clippedSides(V, 390, 844, [[100, -20, 50, 50]]), { ...none, t: true });
  assert.deepEqual(clippedSides(V, 390, 844, [[100, 820, 50, 50]]), { ...none, b: true });
});
test("everything inside clips nothing", () => {
  assert.deepEqual(clippedSides(V, 390, 844, [[10, 10, 100, 50], [200, 700, 100, 50]]), none);
});
test("a zoomed-in view shifts what is clipped", () => {
  // view [200,0,195,422] is 2x: box at board x 300..500 is screen 200..600
  assert.deepEqual(clippedSides([200, 0, 195, 422], 390, 844, [[300, 10, 200, 20]]), { ...none, r: true });
  assert.deepEqual(clippedSides([200, 0, 195, 422], 390, 844, [[100, 10, 200, 20]]), { ...none, l: true });
});
test("a view with a different aspect is centered by meet", () => {
  // 400x400 view in 390x844: scale .975, centered vertically; a box at the board's right edge fits
  assert.deepEqual(clippedSides([0, 0, 400, 400], 390, 844, [[300, 100, 100, 50]]), none);
});
test("syncEdgeCue does not throw without a document", () => {
  assert.doesNotThrow(() => syncEdgeCue(false));
});
