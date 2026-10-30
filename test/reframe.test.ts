import { test } from "node:test";
import assert from "node:assert/strict";
import { atFit, sameView, syncReframe } from "../src/viewer/reframe.ts";
import { st } from "../src/viewer/state.ts";

test("sameView: within half a unit, same length", () => {
  assert.ok(sameView([0, 0, 100, 100], [0.4, -0.4, 100.2, 99.9]));
  assert.ok(!sameView([0, 0, 100, 100], [40, 0, 100, 100]));
  assert.ok(!sameView([0, 0, 100], [0, 0, 100, 100]));
});

test("atFit compares the view with the board's fit", () => {
  st.base = [0, 0, 100, 50];
  st.view = [0.2, 0, 100, 50];
  assert.ok(atFit());
  st.view = [30, 0, 80, 40];
  assert.ok(!atFit());
});

test("syncReframe is a no-op before the button or the board exist", () => {
  assert.doesNotThrow(() => syncReframe());
});
