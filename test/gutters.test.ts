// Wires between packed boxes (viewer/gutters.ts, Everything's group containers): orthogonal, from a
// side of one box to a side of the other, through no other box, and spread apart where they share a gutter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeGutters, type Rect } from "../src/viewer/gutters.ts";

type P = [number, number];
const M = 18;
const box: Record<string, Rect> = {
  a: { x: 0, y: 0, w: 100, h: 60 }, b: { x: 136, y: 0, w: 100, h: 60 }, c: { x: 272, y: 0, w: 100, h: 60 },
  d: { x: 0, y: 96, w: 100, h: 60 }, e: { x: 136, y: 96, w: 100, h: 60 }, f: { x: 272, y: 96, w: 100, h: 60 },
};
const pts = (p: number[]): P[] => p.flatMap((v, i) => (i % 2 ? [] : [[v, p[i + 1]] as P]));
const near = (u: number, v: number) => Math.abs(u - v) < 0.01;
const onBorder = ([x, y]: P, r: Rect) => ((near(x, r.x) || near(x, r.x + r.w)) && y >= r.y && y <= r.y + r.h) || ((near(y, r.y) || near(y, r.y + r.h)) && x >= r.x && x <= r.x + r.w);
const crosses = (p: P, q: P, r: Rect) => Math.min(p[0], q[0]) < r.x + r.w - 0.5 && Math.max(p[0], q[0]) > r.x + 0.5 && Math.min(p[1], q[1]) < r.y + r.h - 0.5 && Math.max(p[1], q[1]) > r.y + 0.5;

test("each wire runs orthogonally from a side of one box to a side of the other, around the rest", () => {
  const edges: [string, string][] = [["a", "c"], ["a", "f"], ["d", "c"], ["b", "e"], ["c", "a"]];
  const rs = routeGutters(box, edges, M);
  rs.forEach((r, i) => {
    const p = pts(r), [s, t] = edges[i];
    assert.ok(p.length >= 2, `${s}>${t} routed`);
    assert.ok(onBorder(p[0], box[s]) && onBorder(p[p.length - 1], box[t]), `${s}>${t} ends on both boxes`);
    for (let j = 1; j < p.length; j++) {
      assert.ok(p[j][0] === p[j - 1][0] || p[j][1] === p[j - 1][1], `${s}>${t} is orthogonal`);
      for (const [k, r2] of Object.entries(box)) if (k !== s && k !== t) assert.ok(!crosses(p[j - 1], p[j], r2), `${s}>${t} crosses ${k}`);
    }
  });
});

test("wires sharing a stretch of gutter are spread apart, so each can be traced", () => {
  // a>c and c>a would run the same way: they must not lie on top of each other
  const [x, y] = routeGutters(box, [["a", "c"], ["c", "a"]], M).map(pts);
  const segs = (p: P[]) => p.slice(1).map((q, i) => [p[i], q] as const);
  for (const [p1, q1] of segs(x)) for (const [p2, q2] of segs(y)) {
    const h = p1[1] === q1[1] && p2[1] === q2[1] && p1[1] === p2[1], v = p1[0] === q1[0] && p2[0] === q2[0] && p1[0] === p2[0];
    if (!h && !v) continue;
    const k = h ? 0 : 1;
    const lo = Math.max(Math.min(p1[k], q1[k]), Math.min(p2[k], q2[k])), hi = Math.min(Math.max(p1[k], q1[k]), Math.max(p2[k], q2[k]));
    assert.ok(hi - lo <= 0.5, "no shared stretch");
  }
});

test("no edges, no wires; the same input gives the same wires", () => {
  assert.deepEqual(routeGutters(box, [], M), []);
  assert.deepEqual(routeGutters(box, [["d", "b"]], M), routeGutters(box, [["d", "b"]], M));
});
