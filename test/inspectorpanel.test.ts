// The inspector panel cleanup (#98): no Tours or Key in the overview panel, a quiet fixed footer, one inspector.css import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewerAssets } from "../src/build/viewer.ts";

const src = (f: string) => readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8");

test("renderOverview no longer lists Tours or the Key", () => {
  const s = src("panels.ts");
  assert.doesNotMatch(s, /tourList|legend/);
  assert.match(src("legend.ts"), /keyCard\(extraRows \+ legendItems\(\)\.map/);
});

test("the footer is a fixed quiet pair of links, hidden when embedded", () => {
  const css = viewerAssets().css.replace(/\s+/g, "");
  assert.doesNotMatch(css, /\.made\{[^}]*position:sticky/);
  assert.match(css, /html:not\(\.embed\)\.made\{[^}]*position:fixed/);
  assert.match(css, /html\.embedheader,html\.embed\.made\{display:none/);
});

test("styles.css imports inspector.css exactly once", () => {
  const n = src("styles.css").split('@import "./inspector.css";').length - 1;
  assert.equal(n, 1);
});
