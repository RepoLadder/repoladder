import { test } from "node:test";
import assert from "node:assert/strict";
import { atTop } from "../src/viewer/fit.ts";
import { atRegion, openRegion } from "../src/viewer/region.ts";

test("openRegion insets by the dock plus an 8px gap, and by the bottom the sheet covers", () => {
  assert.deepEqual(openRegion(1280, 800, { top: 52, right: 328 }), { x: 0, y: 60, w: 944, h: 740 });
  assert.deepEqual(openRegion(390, 844, { top: 78, right: 0 }, 148), { x: 0, y: 86, w: 390, h: 610 });
  assert.deepEqual(openRegion(1280, 800, { top: 0, right: 0 }), { x: 0, y: 0, w: 1280, h: 800 });
});
test("the frame area for a selection excludes the dock", () => {
  const a = openRegion(1280, 800, { top: 52, right: 328 });
  assert.ok(a.y >= 52 && a.x + a.w <= 1280 - 328);
});
test("atRegion over the whole canvas equals atTop with the canvas height", () => {
  for (const [v, cw, ch, open] of [[[0, 0, 400, 200], 400, 600, 200], [[10, 20, 300, 500], 390, 700, 420], [[0, 0, 1000, 400], 800, 800, 800]] as const) {
    assert.deepEqual(atRegion([...v], cw, ch, { x: 0, y: 0, w: cw, h: open }), atTop([...v], cw, ch, open));
  }
});
test("atRegion centers the view in a region with a right inset", () => {
  const w = atRegion([0, 0, 400, 200], 1000, 400, { x: 0, y: 0, w: 600, h: 400 });
  // scale 1.5: the board's center (200, 100) lands at the region's center (300, 200)
  assert.ok(Math.abs(w[0] - (200 - 300 / 1.5)) < 1e-9 && Math.abs(w[2] - 1000 / 1.5) < 1e-9);
});
test("a region under 1px is clamped", () => {
  const r = openRegion(100, 100, { top: 200, right: 500 });
  assert.ok(r.w >= 1 && r.h >= 1);
});
