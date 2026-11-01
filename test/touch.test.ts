import { test } from "node:test";
import assert from "node:assert/strict";
import { atTop, MIN_NAME_PX, NAME_PX, pinchView, readableView, spanStart, toBoard } from "../src/viewer/fit.ts";
import { heights, snapTo } from "../src/viewer/sheet.ts";

const near = (a: number[], b: number[]) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-6, `${a} vs ${b}`));

test("readableView keeps the whole board when names stay readable", () => {
  near(readableView([0, 0, 400, 300], 800, 600), [0, 0, 400, 300]);
});

test("readableView crops a wide board on a phone so names stay at the minimum size (the edge cue marks the clip)", () => {
  const v = readableView([0, 0, 2400, 800], 390, 844);
  assert.ok(v[2] < 2400);
  assert.ok(Math.abs(Math.min(390 / v[2], 844 / v[3]) * NAME_PX - MIN_NAME_PX) < 1e-6);
});

test("readableView stops at the minimum readable zoom, from the board's top left", () => {
  const v = readableView([0, 0, 2000, 1500], 390, 600);
  const scale = Math.min(390 / v[2], 600 / v[3]);
  assert.ok(Math.abs(scale * NAME_PX - MIN_NAME_PX) < 1e-6);
  assert.ok(Math.abs(v[2] / v[3] - 390 / 600) < 1e-9, "keeps the canvas aspect");
  assert.equal(v[0], 0, "starts at the left, not cropped on both sides");
  assert.equal(v[1], 0, "starts at the top");
  // a wide, short board is centered vertically too
  const w = readableView([0, 0, 3000, 200], 390, 600);
  assert.ok(Math.abs(w[1] + w[3] / 2 - 100) < 1e-6);
});

test("toBoard maps through a letterboxed (meet) viewBox", () => {
  const r = { left: 10, top: 20, width: 400, height: 200 };
  // a 100x100 view in a 400x200 box: scale 2, drawn 200 wide, centered with a 100px gutter each side
  near(toBoard([0, 0, 100, 100], r, 110, 20), [0, 0]);
  near(toBoard([0, 0, 100, 100], r, 210, 120), [50, 50]);
});

test("pinchView keeps the point under the fingers and scales by the spread", () => {
  const r = { left: 0, top: 0, width: 390, height: 600 };
  const v0 = [100, 50, 390, 600];
  const p = toBoard(v0, r, 200, 300);
  const v = pinchView(v0, r, [200, 300], [200, 300], 100, 200);
  assert.ok(Math.abs(v[2] - 195) < 1e-6 && Math.abs(v[3] - 300) < 1e-6, "spreading twice as wide halves the view");
  near(toBoard(v, r, 200, 300), p);
  // fingers moving together pan the board with them
  const moved = pinchView(v0, r, [200, 300], [250, 260], 100, 100);
  near(toBoard(moved, r, 250, 260), p);
});

test("sheet heights and snapping", () => {
  const hs = heights(844, 80);
  assert.deepEqual(hs, { peek: 148, half: 422, full: 764 });
  assert.equal(snapTo(160, 0, hs), "peek");
  assert.equal(snapTo(400, 0, hs), "half");
  assert.equal(snapTo(700, 0, hs), "full");
  assert.equal(snapTo(500, 1, hs), "half", "a flick down from above half lands at half");
  assert.equal(snapTo(300, 1, hs), "peek");
  assert.equal(snapTo(300, -1, hs), "half", "a flick up from below half lands at half");
  assert.equal(snapTo(450, -1, hs), "full");
});

test("readableView, cropped top to bottom, starts at the boxes in its left window, not an empty corner (#210)", () => {
  // a tall board whose left column (the story's actors) sits halfway down
  const v = readableView([0, 0, 2000, 3000], 390, 600, undefined, [[0, 1400, 150, 40], [0, 1460, 150, 40], [1500, 0, 150, 40]]);
  assert.equal(v[0], 0);
  assert.ok(v[1] < 1400 && v[1] + v[3] > 1500, `window ${v} holds the left column`);
  // a column taller than the window starts at its top
  const t = readableView([0, 0, 2000, 3000], 390, 600, undefined, [[0, 1000, 150, 40], [0, 2900, 150, 40]]);
  assert.ok(Math.abs(t[1] - 976) < 1e-9);
});

test("atTop frames a view in the canvas's open top part, at the same zoom", () => {
  assert.deepEqual(atTop([0, 0, 400, 200], 400, 600, 200), [0, 0, 400, 600]);
  // a narrower open part: the view's center lands at the open part's center
  const u = atTop([100, 100, 200, 100], 400, 600, 300);
  const k = 400 / u[2];
  assert.ok(Math.abs(k - 2) < 1e-9 && Math.abs((150 - u[1]) * k - 150) < 1e-9);
});

// The story's opening view (#288): fit.ts reads the window at the readable zoom from spanStart over the
// first sentence's boxes (from = its actors' right edge less 24), then readableView frames it.
const opening = (whole: number[], rs: [number, number, number, number][], actorRight = -1 / 0) => {
  const v = readableView(whole, 390, 600);
  return readableView(whole, 390, 600, undefined, rs, spanStart(rs, 0, v[2], actorRight - 24));
};
const inside = (v: number[], r: number[]) => r[0] >= v[0] && r[0] + r[2] <= v[0] + v[2] && r[1] >= v[1] && r[1] + r[3] <= v[1] + v[3];

test("story opening: actor, arrow and part that fit together are centered in the readable window (#288)", () => {
  const actor = [1200, 700, 150, 40], part = [1450, 720, 180, 60] as [number, number, number, number];
  const v = opening([0, 0, 3000, 1500], [actor as typeof part, part], 1350);
  near([v[0], v[1]], [(1176 + 1654 - v[2]) / 2, (676 + 804 - v[3]) / 2]);
  assert.ok(inside(v, actor) && inside(v, part), `${v} holds both`);
  assert.ok(Math.abs(Math.min(390 / v[2], 600 / v[3]) * NAME_PX - MIN_NAME_PX) < 1e-6, "same readable zoom");
});

test("story opening: too wide together, it shows the part and its arrow, the actor off the left edge (#288)", () => {
  const actor = [0, 700, 150, 40] as [number, number, number, number], part = [400, 720, 180, 60] as typeof actor;
  const v = opening([0, 0, 3000, 1500], [actor, part], 150);
  assert.equal(v[0], 126, "reads from 24 left of the actor's right edge, where its arrow leaves");
  assert.ok(inside(v, part), `${v} holds the part`);
  assert.ok(v[0] > actor[0], "the actor's left edge is outside the view");
  // with no actor named, it reads from the boxes' left
  assert.equal(opening([0, 0, 3000, 1500], [[600, 700, 400, 40], [1300, 700, 100, 40]])[0], 576);
});

test("story opening: never pans off the board, on either axis (#288)", () => {
  const v = opening([0, 0, 3000, 1500], [[2900, 1450, 90, 40]]);
  near([v[0] + v[2], v[1] + v[3]], [3000, 1500]);
  const l = opening([0, 0, 3000, 1500], [[0, 0, 40, 40]]);
  near([l[0], l[1]], [0, 0]);
});

test("spanStart: centered on what fits, else from its start or from `from`, whichever is later", () => {
  assert.equal(spanStart([[100, 0, 52, 10]], 0, 200), 26);
  assert.equal(spanStart([[100, 0, 500, 10]], 0, 200), 76);
  assert.equal(spanStart([[100, 0, 500, 10]], 0, 200, 300), 300);
  assert.equal(spanStart([[0, 100, 10, 52]], 1, 200), 26, "the y axis too");
  // readableView's `at` only moves a window narrower than the board
  near(readableView([0, 0, 400, 3000], 390, 600, undefined, [], 999).slice(0, 1), [(400 - 390 / (MIN_NAME_PX / NAME_PX)) / 2]);
});
