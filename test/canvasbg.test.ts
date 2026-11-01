import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewerCss } from "./helpers/viewercss.ts";

test("the viewer gives .canvas the dot grid, on the canvas element only", () => {
  const css = viewerCss().replace(/\s+/g, " ");
  assert.match(css, /\.canvas \{[^}]*background-image: radial-gradient\(circle, var\(--line\) 1px/);
  assert.match(css, /\.canvas \{[^}]*inset: 0/);
});
test("exports never mention the grid", () => {
  for (const f of ["../src/viewer/exportsvg.ts", "../src/build/export.ts"]) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /radial-gradient/);
});
