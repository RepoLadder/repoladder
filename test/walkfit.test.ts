import { test } from "node:test";
import assert from "node:assert/strict";
import { aboveStrip, clearLit, covers, liftAbove, panAbove, walkResized } from "../src/viewer/walkfit.ts";
import type { Box4 } from "../src/viewer/corner.ts";

/** Where board rect r lands on a cw×ch canvas showing view v ("xMidYMid meet"). */
function onScreen(v: number[], cw: number, ch: number, r: number[]): number[] {
  const k = Math.min(cw / v[2], ch / v[3]), ox = (cw - v[2] * k) / 2, oy = (ch - v[3] * k) / 2;
  return [ox + (r[0] - v[0]) * k, oy + (r[1] - v[1]) * k, r[2] * k, r[3] * k];
}

test("walk strip: the board's fit is redone in the canvas above the strip, and never zooms in", () => {
  const base = [0, 0, 900, 600], cw = 900, ch = 600, top = 480;
  const v = aboveStrip(base, cw, ch, top);
  const [x, y, w, h] = onScreen(v, cw, ch, base);
  assert.ok(y >= -0.01 && y + h <= top + 0.01, "the whole board sits above the strip");
  assert.ok(Math.abs(x + w / 2 - cw / 2) < 0.01, "centered across");
  assert.ok(Math.abs(v[2] / v[3] - cw / ch) < 1e-9, "the canvas's aspect, so no letterbox");
  // a board short enough to clear the strip keeps its scale
  const flat = [0, 0, 900, 200], f = aboveStrip(flat, cw, ch, top);
  assert.ok(Math.abs(f[2] - 900) < 0.01);
  assert.ok(onScreen(f, cw, ch, flat)[1] + onScreen(f, cw, ch, flat)[3] <= top);
});

test("walk strip: a step under the strip pans up into view; one already clear stays put", () => {
  const v = [0, 0, 400, 800], cw = 400, ch = 800, top = 640;
  const clear = { x: 50, y: 100, w: 100, h: 100 };
  assert.deepEqual(panAbove(v, cw, ch, top, clear), v);
  const low = { x: 50, y: 650, w: 100, h: 100 }, p = panAbove(v, cw, ch, top, low);
  const r = onScreen(p, cw, ch, [low.x, low.y, low.w, low.h]);
  assert.ok(r[1] + r[3] <= top - 15.99, "above the strip with a margin");
  assert.equal(p[0], v[0]);
  // off to the right, as a phone's cropped view leaves it
  const right = { x: 420, y: 100, w: 100, h: 50 }, q = panAbove(v, cw, ch, top, right);
  assert.ok(onScreen(q, cw, ch, [right.x, right.y, right.w, right.h])[0] + 100 <= cw - 15.99);
});

test("walk strip: the fit can also keep below the corner buttons, and covers() sees a box under them", () => {
  const base = [0, 0, 900, 600], cw = 900, ch = 600, top = 480, btn = [[0, 0, 120, 50]];
  const box = [[0, 0, 200, 80]];
  assert.ok(covers(aboveStrip(base, cw, ch, top), cw, ch, box, btn), "the plain fit puts the top-left box under the buttons");
  const v = aboveStrip(base, cw, ch, top, 50);
  assert.ok(!covers(v, cw, ch, box, btn));
  const [, y, , h] = onScreen(v, cw, ch, base);
  assert.ok(y >= 49.99 && y + h <= top + 0.01, "the board sits between the buttons and the strip");
});

test("walk strip: a resize mid-walk refits above the strip", () => {
  const top = 380, cw = 1000, ch = 500, plain = [0, 0, 1000, 500];
  const r = walkResized(plain, cw, ch, top, null, true);
  assert.deepEqual(r.view, r.base);
  const [, y, , h] = onScreen(r.view!, cw, ch, plain);
  assert.ok(y >= -0.01 && y + h <= top + 0.01, "the board stays above the strip");
  // the step's lit rect is panned above the strip in the new size
  const lit = { x: 900, y: 450, w: 100, h: 50 }, p = walkResized(plain, cw, ch, top, lit, true);
  const s = onScreen(p.view!, cw, ch, [lit.x, lit.y, lit.w, lit.h]);
  assert.ok(s[1] + s[3] <= top - 15.99 && s[0] + s[2] <= cw - 15.99);
  assert.deepEqual(p.base, r.base, "the fit itself does not chase the step");
});

test("walk strip below the canvas (#164): the board keeps its whole-canvas fit, and a step pans into the full canvas", () => {
  const cw = 1000, ch = 500, plain = [0, 0, 1000, 500];
  // walkfit.ts passes the canvas height as the strip's top and leaves the fit as it is
  const r = walkResized(plain, cw, ch, ch, null, true, (b) => b);
  assert.deepEqual(r.base, plain, "no room is reserved for the strip");
  assert.deepEqual(r.view, plain);
  const lit = { x: 900, y: 470, w: 100, h: 50 }, p = walkResized(plain, cw, ch, ch, lit, true, (b) => b);
  const s = onScreen(p.view!, cw, ch, [lit.x, lit.y, lit.w, lit.h]);
  assert.ok(s[1] + s[3] <= ch - 15.99 && s[1] + s[3] > ch - 16.01, "a step off the bottom pans just into view, using the canvas's full height");
  assert.deepEqual(panAbove(plain, cw, ch, ch, { x: 400, y: 200, w: 100, h: 50 }), plain, "a step in view stays put");
});

test("walk strip: a narrow canvas zooms out no further than readable to fit the band; a moved view is left alone", () => {
  const minK = 11 / 14.5, near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  // a landscape phone: the readable fit crops the board across and centers it down the canvas
  const cw = 470, ch = 320, top = 210, board = { x: 0, y: 0, w: 757, h: 140 }, plain = [0, -70, 620, 422];
  const v = liftAbove(plain, cw, ch, top, board);
  assert.ok(near(v[2], plain[2]) && near(v[0], plain[0]), "same zoom, same left edge");
  const [, y, , h] = onScreen(v, cw, ch, [board.x, board.y, board.w, board.h]);
  assert.ok(y >= -0.01 && y + h <= top + 0.01, "the board sits above the strip");
  assert.ok(near(y + h / 2, top / 2), "centered in the band");
  // a board a little too tall at 1:1 zooms out just enough, and is centered across
  const mid = { x: 0, y: 0, w: 300, h: 200 }, m = onScreen(liftAbove([0, 0, 470, 320], cw, ch, top, mid), cw, ch, [0, 0, 300, 200]);
  assert.ok(near(m[3], top - 32) && near(m[1], 16), "fills the band with a margin");
  assert.ok(near(m[0] + m[2] / 2, cw / 2));
  // a board too tall even at the readable floor stops there, its top at the band's top
  const tall = { x: 0, y: 0, w: 500, h: 2000 }, t = liftAbove([0, 30, 470, 320], cw, ch, top, tall, 40);
  assert.ok(near(cw / t[2], minK), "never below the readable zoom");
  assert.ok(near(onScreen(t, cw, ch, [0, 0, 500, 2000])[1], 56));
  const r = walkResized(plain, cw, ch, top, null, true, (b) => liftAbove(b, cw, ch, top, board));
  assert.deepEqual(r.base, v);
  const moved = walkResized([0, 0, 1000, 500], 1000, 500, 380, null, false);
  assert.equal(moved.view, null);
});

// A phone canvas 390×844 with the strip from 600 down; the dial's column top right
test("clearLit (#287): a lit box under the dial moves down or slides, never under the strip", () => {
  const cw = 390, ch = 844, top = 600, p = [0, 0, 390, 844], dial: Box4 = [340, 0, 50, 300];
  const out = clearLit(p, [[300, 100, 60, 40]], cw, ch, top, [dial], 60);
  assert.notDeepEqual(out, p);
  assert.ok(!covers(out, cw, ch, [[300, 100, 60, 40]], [dial]));
  assert.deepEqual([out[2], out[3]], [390, 844], "keeps its zoom");
  // a dial reaching too far down: moving down would put the box under the strip, so it slides
  const tall: Box4 = [340, 0, 50, 580], box: Box4 = [300, 500, 60, 40], s = clearLit(p, [box], cw, ch, top, [tall], 60);
  const r = onScreen(s, cw, ch, box);
  assert.ok(s[0] > 20 && s[0] <= 60, "slid by little more than it takes");
  assert.ok(r[1] + r[3] <= top && r[0] + r[2] <= tall[0], "clear of the dial, above the strip");
});

test("clearLit (#287): never pushes a lit box off the canvas's left edge; p when nothing clears", () => {
  const cw = 390, ch = 844, top = 600, p = [0, 0, 390, 844], wall: Box4 = [340, 0, 50, 844];
  const lit: Box4[] = [[0, 100, 60, 40], [300, 100, 60, 40]];
  assert.deepEqual(clearLit(p, lit, cw, ch, top, [wall], 60), p);
  // with room on the left it slides, and the leftmost box stays on screen
  const roomy: Box4[] = [[40, 100, 60, 40], [300, 100, 60, 40]], s = clearLit(p, roomy, cw, ch, top, [wall], 60);
  assert.ok(s[0] > 0);
  for (const b of roomy) assert.ok(onScreen(s, cw, ch, b)[0] >= 0);
});
