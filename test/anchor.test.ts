import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorFor } from "../src/viewer/anchor.ts";

const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }) as DOMRect;
const canvas = rect(0, 0, 1000, 800);

test("a button in the upper half opens its popover downward", () => {
  const a = anchorFor(rect(940, 10, 30, 28), canvas);
  assert.deepEqual(a, { top: 42, right: 30 });
});

test("a button in the lower half opens it upward", () => {
  const a = anchorFor(rect(940, 760, 30, 28), canvas);
  assert.deepEqual(a, { bottom: 44, right: 30 });
});

test("offsets are never negative", () => {
  const a = anchorFor(rect(990, 790, 30, 28), canvas);
  assert.equal(a.right, 0);
  assert.ok((a.bottom ?? 0) >= 0);
});
