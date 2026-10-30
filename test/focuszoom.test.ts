import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { focusView, sameView, union } from "../src/viewer/focuszoom.ts";

test("focus zoom: the selection lands centered in the open part of the canvas, no closer than the cap", () => {
  assert.deepEqual(union([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }]), { x: 0, y: -5, w: 25, h: 15 });
  const b = { x: 100, y: 100, w: 200, h: 100 };
  // 800×600 canvas, all open: fits the width (744/200 = 3.72) but the cap (1.5) wins
  const v = focusView(b, 800, 600, { x: 0, y: 0, w: 800, h: 600 }, 1.5);
  assert.deepEqual(v, [200 - 400 / 1.5, 150 - 300 / 1.5, 800 / 1.5, 600 / 1.5]);
  // a phone with the sheet over the bottom half: the box centers in the top half
  const k = (390 - 56) / 200;
  const p = focusView(b, 390, 800, { x: 0, y: 0, w: 390, h: 400 }, 9);
  assert.ok(Math.abs(p[2] - 390 / k) < 1e-9);
  assert.ok(Math.abs((150 - p[1]) * k - 200) < 1e-9, "box center sits at the middle of the open area");
});

test("focus zoom: a view the reader moved is not the one the zoom left", () => {
  assert.ok(sameView([10, 20, 300, 200], [10.2, 19.8, 300, 200]));
  assert.ok(!sameView([10, 20, 300, 200], [40, 20, 300, 200]));
  assert.ok(!sameView([10, 20, 300, 200], [10, 20, 360, 240]));
});

test("bundled arrows are gone (#101): every line traceable on its own", () => {
  assert.ok(!existsSync(new URL("../src/viewer/bundle.ts", import.meta.url)));
  assert.ok(!existsSync(new URL("../src/viewer/deep.ts", import.meta.url)));
});

