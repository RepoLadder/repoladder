import { test } from "node:test";
import assert from "node:assert/strict";
import { fsState } from "../src/viewer/fullscreen.ts";

test("fsState names the button for each state", () => {
  assert.deepEqual(fsState(true), { label: "Exit full screen", pressed: "true" });
  assert.deepEqual(fsState(false), { label: "Full screen", pressed: "false" });
});
