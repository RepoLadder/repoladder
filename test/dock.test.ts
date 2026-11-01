import { test } from "node:test";
import assert from "node:assert/strict";
import { dockOf } from "../src/viewer/dock.ts";

const rect = (left: number, top: number, w: number, h: number) => ({ left, top, width: w, right: left + w, bottom: top + h });
const canvas = rect(0, 0, 1280, 800);

test("a header floating over the canvas docks its bottom edge", () => {
  assert.deepEqual(dockOf(canvas, rect(12, 12, 1256, 40), null, false, false), { top: 52, right: 0 });
});
test("a header outside the canvas (embedded: hidden, toolbar above a framed canvas) docks nothing", () => {
  assert.deepEqual(dockOf(rect(24, 44, 1000, 600), rect(0, 0, 0, 0), null, false, false), { top: 0, right: 0 });
  assert.deepEqual(dockOf(rect(24, 44, 1000, 600), rect(0, 0, 1280, 44), null, false, false), { top: 0, right: 0 });
});
test("a panel floating over the right of the canvas docks its width", () => {
  assert.deepEqual(dockOf(canvas, rect(12, 12, 1256, 40), rect(952, 64, 316, 724), false, false), { top: 52, right: 328 });
});
test("a panel beside the canvas (embedded grid) docks nothing", () => {
  assert.equal(dockOf(rect(24, 44, 900, 600), null, rect(944, 0, 316, 700), false, false).right, 0);
});
test("a narrow window has no right dock: the panel is the bottom sheet", () => {
  assert.deepEqual(dockOf(rect(0, 0, 390, 844), rect(8, 8, 374, 70), rect(0, 700, 390, 148), true, false), { top: 78, right: 0 });
});
test("full screen and missing elements dock nothing", () => {
  assert.deepEqual(dockOf(canvas, rect(12, 12, 1256, 40), rect(952, 64, 316, 724), false, true), { top: 0, right: 0 });
  assert.deepEqual(dockOf(canvas, null, null, false, false), { top: 0, right: 0 });
});
