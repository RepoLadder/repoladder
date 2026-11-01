import { test } from "node:test";
import assert from "node:assert/strict";
import { R, RX, boxBody, shadeOk } from "../src/viewer/shapes.ts";
import { edgeDist, roundRect } from "../src/build/outline.ts";

const box = { x: 0, y: 0, w: 120, h: 60 };

test("the layout radius does not move in a restyle", () => {
  assert.deepEqual(R, { web: 8, backend: 4, library: 8, scripts: 2, part: 8 });
});

test("the drawn radius stays within 2 units of the layout outline", () => {
  for (const k of Object.keys(R) as (keyof typeof R)[]) {
    assert.ok(RX[k] >= R[k], k);
    const a = roundRect(box, R[k]), b = roundRect(box, RX[k]);
    const gap = Math.max(...b.map((p) => edgeDist(p, a)), ...a.map((p) => edgeDist(p, b)));
    assert.ok(gap <= 2, `${k}: ${gap}`);
  }
});

test("a web box's band path is well-formed and ends at the bar height", () => {
  const out = boxBody({ ...box, name: "Web", subs: [], kind: "web" });
  assert.ok(!out.includes("NaN"));
  const band = out.match(/class="band" d="([^"]+)"/)![1];
  assert.ok(band.startsWith("M0 10V10Q"));
  assert.ok(band.endsWith("V10z"));
});

test("shadeOk caps shaded boards at 150 nodes", () => {
  assert.equal(shadeOk(150), true);
  assert.equal(shadeOk(151), false);
});
