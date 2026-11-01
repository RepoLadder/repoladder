import { test } from "node:test";
import assert from "node:assert/strict";
import { clipped, overlaps } from "../scripts/design.ts";
import { phoneCover } from "../src/viewer/region.ts";

const R = (name: string, left: number, top: number, right: number, bottom: number) => ({ name, left, top, right, bottom });

test("overlaps flags a partial intersection, ignores containment and touching edges", () => {
  assert.deepEqual(overlaps([R("a", 0, 0, 100, 100), R("b", 50, 50, 150, 150)]), [["a", "b"]]);
  assert.deepEqual(overlaps([R("a", 0, 0, 100, 100), R("b", 10, 10, 20, 20)]), []);
  assert.deepEqual(overlaps([R("a", 0, 0, 100, 100), R("b", 100, 0, 200, 100)]), []);
  assert.deepEqual(overlaps([R("a", 0, 0, 100, 100), R("b", 0, 100, 100, 200)]), []);
});

test("clipped flags rects outside the viewport", () => {
  assert.deepEqual(clipped([R("in", 0, 0, 390, 844), R("right", 300, 10, 400, 50), R("top", 10, -5, 50, 40)], 390, 844), ["right", "top"]);
});

test("phoneCover: peek only, peek plus dock, and the 40% floor", () => {
  assert.equal(phoneCover(800, 148, 0), 148);
  assert.equal(phoneCover(800, 148, 90), 238);
  assert.equal(phoneCover(800, 422, 200), 480);
  assert.equal(phoneCover(800, -10, 0), 0);
});
