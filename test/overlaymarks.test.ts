// The overlay's pure helpers: which mark an id wears, the removed-connection path, the legend numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { legendModel, markFor, removedBetween, type Marks } from "../src/viewer/overlaymarks.ts";

const marks: Marks = {
  changed: ["n:a", "n:b"], added: ["n:b", "n:c"], addedEdges: ["e:a>b"], removedEdges: ["e:b>c", "e:c>a"],
  parts: [{ id: "a", name: "A", files: 2 }],
};

test("markFor: a new box beats a changed one, connections are added, the rest wear nothing", () => {
  assert.equal(markFor(marks, "n:a"), "changed");
  assert.equal(markFor(marks, "n:b"), "new");
  assert.equal(markFor(marks, "n:c"), "new");
  assert.equal(markFor(marks, "e:a>b"), "added");
  assert.equal(markFor(marks, "e:b>c"), null, "removed connections are drawn by the overlay, not marked");
  assert.equal(markFor(marks, "n:zzz"), null);
});

const clean = (d: string) => {
  assert.ok(!/NaN|Infinity/.test(d), d);
  const [x1, y1, x2, y2] = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  assert.ok(Math.hypot(x2 - x1, y2 - y1) > 1, `zero-length path ${d}`);
};

test("removedBetween: clipped to the borders for boxes side by side and stacked", () => {
  const side = removedBetween({ x: 0, y: 0, w: 100, h: 40 }, { x: 200, y: 0, w: 100, h: 40 });
  assert.equal(side, "M100 20L200 20");
  const stacked = removedBetween({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 140, w: 100, h: 40 });
  assert.equal(stacked, "M50 40L50 140");
  const reverse = removedBetween({ x: 200, y: 0, w: 100, h: 40 }, { x: 0, y: 0, w: 100, h: 40 });
  assert.equal(reverse, "M200 20L100 20");
});

test("removedBetween: diagonal ends sit on the borders", () => {
  const d = removedBetween({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 300, w: 100, h: 100 });
  assert.equal(d, "M100 100L300 300");
});

test("removedBetween: touching, overlapping and coincident rectangles give a usable stub", () => {
  for (const b of [{ x: 100, y: 0, w: 100, h: 40 }, { x: 50, y: 10, w: 100, h: 40 }, { x: 0, y: 0, w: 100, h: 40 }, { x: 10, y: 10, w: 20, h: 10 }]) clean(removedBetween({ x: 0, y: 0, w: 100, h: 40 }, b));
});

test("legendModel counts each kind; a box both changed and new counts once, as new", () => {
  const m = legendModel(marks);
  assert.deepEqual(m.counts, { changed: 1, new: 2, added: 1, removed: 2 });
  assert.deepEqual(m.parts, marks.parts);
});
