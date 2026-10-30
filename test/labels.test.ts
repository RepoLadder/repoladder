import { test } from "node:test";
import assert from "node:assert/strict";
import { labelPrio, overlap, placeLabels, pointAt, samples } from "../src/viewer/labels.ts";
import { litBy } from "../src/viewer/focus.ts";

const rects = (placed: { x: number; y: number }[], w: number, h: number) => placed.map((p) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h }));

test("pointAt walks the polyline by length", () => {
  const pts = samples(0, [0, 0, 100, 0, 100, 100]);
  assert.deepEqual(pointAt(pts, 0.5), [100, 0]);
  assert.deepEqual(pointAt(pts, 0.25), [50, 0]);
  const curve = samples(1, [0, 0, 0, 50, 100, 50, 100, 100]);
  assert.equal(curve.length, 17);
  assert.deepEqual(curve[16], [100, 100]);
});

test("a label at a clear midpoint stays there", () => {
  const [p] = placeLabels([], [{ curve: 0, p: [0, 0, 0, 200], w: 60, h: 18, prio: 1 }]);
  assert.deepEqual(p, { x: 0, y: 100, lo: false });
});

test("parallel wires get labels that do not overlap each other", () => {
  // three near-parallel wires into one store, like a large app's "reads & writes" edges
  const items = [0, 20, 40].map((x) => ({ curve: 0 as const, p: [x, 0, x, 300], w: 110, h: 18, prio: 2e6 }));
  const placed = placeLabels([], items);
  assert.ok(placed.every((p) => !p.lo));
  const r = rects(placed, 110, 18);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.equal(overlap(r[i], r[j]), 0);
});

test("labels slide off boxes, and higher priority gets the midpoint", () => {
  const box = { x: -50, y: 90, w: 100, h: 20 };
  const [a] = placeLabels([box], [{ curve: 0, p: [0, 0, 0, 200], w: 40, h: 18, prio: 1 }]);
  assert.equal(overlap({ x: a.x - 20, y: a.y - 9, w: 40, h: 18 }, box), 0);
  const [lo, hi] = placeLabels([], [0, 1].map((prio) => ({ curve: 0 as const, p: [0, 0, 0, 200], w: 40, h: 18, prio })));
  assert.equal(hi.y, 100);
  assert.notEqual(lo.y, 100);
});

test("a label with no free spot is marked lo and does not block others", () => {
  const box = { x: -100, y: -100, w: 200, h: 400 };
  const [p] = placeLabels([box], [{ curve: 0, p: [0, 0, 0, 200], w: 40, h: 18, prio: 1 }]);
  assert.equal(p.lo, true);
});

test("placement is deterministic", () => {
  const items = [0, 10, 20, 30].map((x) => ({ curve: 0 as const, p: [x, 0, x + 50, 200], w: 70, h: 18, prio: 1 }));
  assert.deepEqual(placeLabels([], items), placeLabels([], items));
});

test("label priority: busier data arrows, then story verbs, hubs last", () => {
  const order = [{ reads: 3, writes: 2 }, { reads: 3 }, {}, { reads: 9, hub: true as const }].map(labelPrio);
  assert.deepEqual([...order].sort((a, b) => b - a), order);
});

test("focusing a box lights its wires and neighbors; a wire lights its ends", () => {
  const hits = ["n:a", "n:b", "n:c", "n:d", "e:a>b", "e:c>a", "e:c>d"];
  assert.deepEqual([...litBy("n:a", hits)].sort(), ["e:a>b", "e:c>a", "n:a", "n:b", "n:c"]);
  assert.deepEqual([...litBy("e:c>d", hits)].sort(), ["e:c>d", "n:c", "n:d"]);
});
