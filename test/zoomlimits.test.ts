import assert from "node:assert/strict";
import { test } from "node:test";
import { clampFactor, clampView, IN_MIN_K, IN_TIMES, limitsFor, NOTCH, OUT_MARGIN, scaleOf, wheelFactor } from "../src/viewer/zoomlimits.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const whole = [0, 0, 1000, 500];
// a 1000×500 canvas showing the whole board: 1px per unit
const L = limitsFor(whole, whole, 1000, 500);

test("limits: out to a little past the whole board's fit, in to 4× the fit (at least 2px per unit)", () => {
  near(L.kMin, 1 / OUT_MARGIN);
  near(L.kMax, Math.max(IN_TIMES, IN_MIN_K));
  // a big board fitted small: 4× its fit is still tiny, so the floor of 2px per unit applies
  const big = limitsFor([0, 0, 10000, 5000], [0, 0, 10000, 5000], 1000, 500);
  near(big.kMax, IN_MIN_K);
  // a phone's readable (cropped) opening view: out to the whole board, in to 4× the opening view
  const phone = limitsFor([0, 0, 2000, 2000], [0, 0, 500, 500], 400, 400);
  near(phone.kMin, 0.2 / OUT_MARGIN);
  near(phone.kMax, 4 * 0.8);
});

test("clampFactor stops zooming at the floor and the ceiling, and passes moves inside them", () => {
  near(clampFactor(whole, 1.05, 1000, 500, L), 1.05);
  near(clampFactor(whole, 5, 1000, 500, L), OUT_MARGIN);
  near(clampFactor(whole, 0.01, 1000, 500, L), 1 / L.kMax);
  // already at the floor: zooming out further does nothing, zooming in still works
  const out = [0, 0, 1100, 550];
  near(clampFactor(out, 1.2, 1000, 500, L), 1);
  near(clampFactor(out, 0.5, 1000, 500, L), 0.5);
});

test("clampView leaves a view in bounds as it is", () => {
  const v = [100, 50, 400, 200];
  assert.deepEqual(clampView(v, 1000, 500, L), v);
  assert.deepEqual(clampView(whole, 1000, 500, L), whole);
});

test("clampView zooms a too-far-out view back to the floor about the anchor", () => {
  const v = clampView([-4500, -2250, 10000, 5000], 1000, 500, L);
  near(scaleOf(v, 1000, 500), L.kMin);
  near(v[0] + v[2] / 2, 500);
  near(v[1] + v[3] / 2, 250);
  // anchored at the top left: that corner stays put
  const a = clampView([0, 0, 2000, 1000], 1000, 500, L, 0, 0);
  near(a[0], 0); near(a[1], 0); near(scaleOf(a, 1000, 500), L.kMin);
});

test("clampView zooms a too-close view back to the ceiling", () => {
  const v = clampView([490, 245, 20, 10], 1000, 500, L);
  near(scaleOf(v, 1000, 500), L.kMax);
  near(v[0] + v[2] / 2, 500);
});

test("clampView keeps the board on the canvas: a third of the canvas, or all of a smaller board", () => {
  // dragged far right at the fit: at least a third of the canvas still shows board
  const v = clampView([5000, 0, 1000, 500], 1000, 500, L);
  near(v[0], 1000 - 1000 / 3);
  const up = clampView([0, -5000, 1000, 500], 1000, 500, L);
  near(up[1], 500 / 3 - 250 - 250);
  // zoomed out to the floor, a board narrower than a third of the canvas stays fully on it
  const thin = limitsFor([0, 0, 100, 500], [0, 0, 100, 500], 1000, 500);
  const t = clampView([-2000, 0, 1100, 550], 1000, 500, thin);
  near(t[0], -1000);
  assert.ok(t[0] <= 0 && t[0] + t[2] >= 100);
});

test("clampView ignores a canvas or board with no size yet", () => {
  const v = [1, 2, 3, 4];
  assert.deepEqual(clampView(v, 0, 0, L), v);
  assert.deepEqual(clampView(v, 100, 100, limitsFor([0, 0, 0, 0], [0, 0, 0, 0], 100, 100)), v);
});

test("wheelFactor: one mouse notch is one step, smaller deltas zoom proportionally less", () => {
  near(wheelFactor(100), NOTCH);
  near(wheelFactor(-100), 1 / NOTCH);
  near(wheelFactor(0), 1);
  // a trackpad's 4px nudge is a small fraction of a notch
  assert.ok(wheelFactor(4) < 1.005);
  // line and page modes (Firefox) scale to pixels; one event never zooms more than a notch
  near(wheelFactor(3, 1), Math.exp((Math.log(NOTCH) / 100) * 99));
  near(wheelFactor(1, 2), NOTCH);
  near(wheelFactor(1000), NOTCH);
  near(wheelFactor(-1000), 1 / NOTCH);
});

test("wheelFactor: a ctrl+wheel trackpad pinch is steeper per pixel but capped at a notch", () => {
  assert.ok(wheelFactor(5, 0, true) > wheelFactor(5));
  near(wheelFactor(5, 0, true), Math.exp(0.05));
  near(wheelFactor(80, 0, true), NOTCH);
  near(wheelFactor(-80, 0, true), 1 / NOTCH);
});
