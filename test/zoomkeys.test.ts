import assert from "node:assert/strict";
import { test } from "node:test";
import { zoomKeyAction } from "../src/viewer/zoomkeys.ts";

const none = { ctrl: false, meta: false, alt: false };

test("+ and = zoom in, - and _ zoom out, f and F reframe", () => {
  for (const k of ["+", "="]) assert.equal(zoomKeyAction(k, none, false), "in");
  for (const k of ["-", "_"]) assert.equal(zoomKeyAction(k, none, false), "out");
  for (const k of ["f", "F"]) assert.equal(zoomKeyAction(k, none, false), "fit");
});

test("a held Ctrl, Meta or Alt leaves the key to the browser", () => {
  for (const m of [{ ...none, ctrl: true }, { ...none, meta: true }, { ...none, alt: true }])
    for (const k of ["+", "-", "=", "f"]) assert.equal(zoomKeyAction(k, m, false), null);
});

test("nothing fires while typing or for unrelated keys", () => {
  for (const k of ["+", "-", "f"]) assert.equal(zoomKeyAction(k, none, true), null);
  for (const k of ["a", "0", "Enter", "Escape", "ArrowUp", "Shift"]) assert.equal(zoomKeyAction(k, none, false), null);
});
