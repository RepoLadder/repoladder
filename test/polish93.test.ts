import { test } from "node:test";
import assert from "node:assert/strict";
import { clearCorner, slideCap, type Box4 } from "../src/viewer/corner.ts";
import { crosses, storeRoute } from "../src/viewer/storewire.ts";
import type { Rect } from "../src/viewer/xwire.ts";

// a 1000×500 board shown whole on a 1000×500 canvas; buttons in the top right corner
const BTN: Box4 = [890, 2, 108, 40];

test("clearCorner leaves a view alone when no box is under the zoom buttons", () => {
  const v = [0, 0, 1000, 500];
  assert.deepEqual(clearCorner(v, [[0, 0, 100, 40]], 1000, 500, BTN), v);
});

test("clearCorner grows the view just enough to clear a box under the buttons", () => {
  const v = [0, 0, 1000, 500], box: Box4 = [880, 10, 100, 40];
  const out = clearCorner(v, [box], 1000, 500, BTN);
  assert.notDeepEqual(out, v);
  assert.ok(out[2] >= 1000 && out[3] >= 500, "grows, never crops");
  assert.ok(out[2] < 1200 && out[3] < 700, "by a little");
  // the box is no longer under the buttons
  const s = Math.min(1000 / out[2], 500 / out[3]), ox = (1000 - out[2] * s) / 2, oy = (500 - out[3] * s) / 2;
  const sx = ox + (box[0] - out[0]) * s, sy = oy + (box[1] - out[1]) * s;
  assert.ok(sy >= BTN[1] + BTN[3] || sx + box[2] * s <= BTN[0]);
});

test("clearCorner moves a cropped (phone) view down rather than zooming out", () => {
  const v = [0, 0, 300, 600];
  const out = clearCorner(v, [[200, 0, 100, 40]], 300, 600, [200, 0, 100, 40], true);
  assert.equal(out[0], 0);
  assert.equal(out[2], 300);
  assert.equal(out[3], 600);
  assert.ok(out[1] < -39);
});

// Back / Forward on the canvas's top left (#148), the zoom buttons on its top right
const HIST: Box4 = [2, 4, 79, 40];
const onCanvas = (v: number[], cw: number, ch: number, r: Box4): Box4 => {
  const s = Math.min(cw / v[2], ch / v[3]), ox = (cw - v[2] * s) / 2, oy = (ch - v[3] * s) / 2;
  return [ox + (r[0] - v[0]) * s, oy + (r[1] - v[1]) * s, r[2] * s, r[3] * s];
};
const under = (a: Box4, b: Box4) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

test("clearCorner keeps the fit clear of Back / Forward on the top left too", () => {
  const v = [0, 0, 1000, 500], box: Box4 = [10, 10, 100, 40];
  assert.deepEqual(clearCorner(v, [box], 1000, 500, BTN), v, "the zoom corner alone leaves it");
  const out = clearCorner(v, [box], 1000, 500, [BTN, HIST]);
  assert.notDeepEqual(out, v);
  assert.ok(out[2] >= 1000 && out[3] >= 500 && out[2] < 1200 && out[3] < 700, "grows a little, never crops");
  assert.ok(!under(onCanvas(out, 1000, 500, box), HIST));
});

test("clearCorner clears both corners at once when a board's top row spans the canvas", () => {
  const v = [0, 0, 1000, 500], boxes: Box4[] = [[10, 10, 100, 40], [880, 10, 100, 40], [400, 300, 100, 40]];
  const out = clearCorner(v, boxes, 1000, 500, [BTN, HIST]);
  for (const b of boxes) for (const c of [BTN, HIST]) assert.ok(!under(onCanvas(out, 1000, 500, b), c));
});

test("on a phone (cropped view) the board moves down from under Back / Forward, keeping its zoom", () => {
  const v = [0, 0, 300, 600];
  const out = clearCorner(v, [[0, 0, 100, 40]], 300, 600, [[200, 0, 100, 40], [0, 0, 90, 52]], true);
  assert.deepEqual([out[0], out[2], out[3]], [0, 300, 600]);
  assert.ok(out[1] <= -52);
});

// #287: a phone's cropped view of a board wider than the canvas, the dial's column top right
const DIAL: Box4 = [350, 0, 40, 600];

test("clearCorner slides a cropped view sideways when moving down cannot clear the dial", () => {
  const v = [0, 0, 390, 600], box: Box4 = [300, 100, 60, 40];
  assert.deepEqual(clearCorner(v, [box], 390, 600, DIAL, true), v, "the default maxX keeps it down-only (and nothing clears)");
  const out = clearCorner(v, [box], 390, 600, DIAL, true, 50);
  assert.ok(out[0] > v[0] && out[0] <= 50, "slides, within maxX");
  assert.ok(out[0] < 10 + 390 / 100 * 2 + 0.01, "by the least that clears");
  assert.deepEqual([out[2], out[3]], [390, 600], "same zoom");
  assert.equal(out[1], 0, "and no further down than it must");
  assert.deepEqual(clearCorner(v, [box], 390, 600, DIAL, true, 5), v, "a maxX too small to clear leaves it");
});

test("clearCorner prefers moving a cropped view down to sliding it", () => {
  const v = [0, 0, 390, 600], out = clearCorner(v, [[300, 0, 60, 40]], 390, 600, [350, 0, 40, 60], true, 50);
  assert.equal(out[0], 0);
  assert.ok(out[1] <= -60);
});

test("slideCap: the dial's width in board units at the view's zoom, capped at the board's right edge", () => {
  assert.equal(slideCap([0, 0, 390, 600], [0, 0, 1000, 600], 40, 390, 600), 40);
  assert.equal(slideCap([0, 0, 195, 300], [0, 0, 1000, 300], 40, 390, 600), 20, "zoomed in 2×: half as many units");
  assert.equal(slideCap([0, 0, 390, 600], [0, 0, 410, 600], 40, 390, 600), 20, "never past the board's right edge");
  assert.equal(slideCap([0, 0, 390, 600], [0, 0, 390, 600], 40, 390, 600), 0, "a view as wide as the board does not slide");
  assert.equal(slideCap([10, 0, 390, 600], [0, 0, 390, 600], 40, 390, 600), 10, "nor below its own x");
});

// A store board: two parts on the left, a grid of collections on the right (44 tall cells, 22 apart).
const part: Rect = [0, 0, 160, 44];
const grid = (c: number, r: number): Rect => [200 + c * 178, r * 66, 160, 44];

function boxesCrossed(pts: number[], others: Rect[]): number {
  let n = 0;
  for (let i = 2; i < pts.length; i += 2) for (const r of others) if (crosses([pts[i - 2], pts[i - 1]], [pts[i], pts[i + 1]], r)) n++;
  return n;
}

test("storeRoute goes straight in from the gutter when nothing is in the way", () => {
  const b = grid(0, 2), others = [grid(1, 2), grid(0, 1)];
  const pts = storeRoute(part, b, others);
  assert.deepEqual(pts.slice(0, 2), [160, 22], "leaves the part's right side");
  assert.deepEqual(pts.slice(-2), [200, 154], "ends on the collection's left side");
  assert.ok(pts.length <= 8, "at most two bends");
  assert.equal(boxesCrossed(pts, others), 0);
});

test("storeRoute runs through the row gap instead of across a box in its way", () => {
  const b = grid(2, 1), others = [grid(0, 1), grid(1, 1), grid(0, 0), grid(1, 0), grid(2, 0), grid(0, 2), grid(1, 2), grid(2, 2)];
  const pts = storeRoute(part, b, others);
  assert.equal(boxesCrossed(pts, others), 0);
  // every segment is horizontal or vertical
  for (let i = 2; i < pts.length; i += 2) assert.ok(pts[i] === pts[i - 2] || pts[i + 1] === pts[i - 1]);
  const [ex, ey] = pts.slice(-2);
  assert.ok(ey === b[1] || ey === b[1] + b[3], "enters through the top or the bottom");
  assert.equal(ex, b[0] + b[2] / 2);
});

test("storeRoute enters a subcollection through its frame", () => {
  const frame: Rect = [193, 59, 334, 117], sub = grid(1, 2);
  const others = [frame, grid(0, 1), grid(0, 2), grid(0, 0), grid(1, 0)];
  const pts = storeRoute(part, sub, others);
  assert.equal(boxesCrossed(pts, others.filter((r) => r !== frame)), 0);
});
