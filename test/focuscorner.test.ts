import { test } from "node:test";
import assert from "node:assert/strict";
import { clearOfButtons } from "../src/viewer/focuscorner.ts";
import { onScreen, hits, type Box4 } from "../src/viewer/corner.ts";
import { focusView } from "../src/viewer/focuszoom.ts";

// a 375×700 phone canvas, the sheet over its bottom 300px; Back/Forward top left, zoom top right
const W = 375, H = 700, area = { x: 0, y: 0, w: W, h: 400 };
const btns: Box4[] = [[2, 4, 100, 52], [230, 4, 143, 52]];
const under = (v: number[], bs: Box4[]) => bs.some((r) => btns.some((b) => hits(onScreen(v, W, H, r), b)));
const frame = (union: { x: number; y: number; w: number; h: number }, boxes: Box4[], kMin = 0.01, b = btns) =>
  ({ fit: (a: typeof area) => focusView(union, W, H, a, 9), area, union, boxes, w: W, h: H, btns: b, kMin });

test("phone focus zoom: a tall selection that would reach under a corner button is framed below the buttons", () => {
  // tall: the height limits the zoom, so the top box lands 28px from the canvas top, under Back
  const f = frame({ x: 0, y: 0, w: 100, h: 200 }, [[0, 0, 100, 40], [0, 160, 100, 40]]);
  assert.ok(under(f.fit(area), f.boxes), "the plain fit puts the top box under the buttons");
  const v = clearOfButtons(f);
  assert.ok(!under(v, f.boxes));
  // the top box sits just below the lowest button, not further
  const top = onScreen(v, W, H, f.boxes[0])[1];
  assert.ok(top >= 56 + 8 - 1e-9 && top < 56 + 8 + 1, `top at ${top}`);
});

test("phone focus zoom: a selection already clear of the buttons keeps its plain fit", () => {
  // wide: the width limits the zoom and the selection centers low in the open area
  const f = frame({ x: 0, y: 0, w: 400, h: 60 }, [[0, 0, 400, 60]]);
  assert.deepEqual(clearOfButtons(f), f.fit(area));
  // no buttons on the canvas: nothing to clear
  const g = frame({ x: 0, y: 0, w: 100, h: 200 }, [[0, 0, 100, 40]], 0.01, []);
  assert.deepEqual(clearOfButtons(g), g.fit(area));
});

test("phone focus zoom: at the least zoom allowed, the selection's top still lands below the buttons", () => {
  // the fit below the buttons wants k ≈ 0.4; the floor is 1, so the view keeps k = 1 and anchors the top
  const f = frame({ x: 0, y: 0, w: 300, h: 800 }, [[0, 0, 300, 40], [0, 760, 300, 40]], 1);
  const v = clearOfButtons(f);
  assert.ok(Math.abs(W / v[2] - 1) < 1e-9, "zoom held at the floor");
  assert.ok(!under(v, f.boxes));
  assert.ok(Math.abs(onScreen(v, W, H, f.boxes[0])[1] - 64) < 1e-9, "top box just below the buttons");
});

test("phone focus zoom: when the selection can't all fit, the selected box stays in the open area", () => {
  // the selected box is at the bottom of a selection too tall for the least zoom: anchoring the top
  // would put it under the sheet, so the view moves up until it sits just above the sheet
  const sel: Box4 = [0, 760, 300, 40];
  const f = { ...frame({ x: 0, y: 0, w: 300, h: 800 }, [[0, 0, 300, 40], sel], 1), sel };
  const s = onScreen(clearOfButtons(f), W, H, sel);
  assert.ok(Math.abs(s[1] + s[3] - (400 - 8)) < 1e-9, `selected box bottom at ${s[1] + s[3]}`);
  assert.ok(s[0] >= 8 && s[0] + s[2] <= W - 8);
});

test("phone focus zoom: held at the readable zoom, a wide selection keeps the selected box in the open area (#210)", () => {
  // the selection spans 3000 units: fitting it would shrink names to nothing; the floor holds k = 0.76
  const sel: Box4 = [2800, 100, 150, 50];
  const f = { ...frame({ x: 0, y: 100, w: 3000, h: 50 }, [[0, 100, 150, 50], sel], 0.76, []), sel };
  const v = clearOfButtons(f);
  assert.ok(Math.abs(W / v[2] - 0.76) < 1e-9, "zoom held at the floor");
  const s = onScreen(v, W, H, sel);
  assert.ok(s[0] >= 0 && s[0] + s[2] <= W && s[1] >= 0 && s[1] + s[3] <= area.h, `selected box at ${s}`);
});
