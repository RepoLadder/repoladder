import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerAssets } from "../src/build/viewer.ts";

const css = viewerAssets().css;
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `rule ${selector} exists`);
  return m[1]!;
};

test("the panel padding covers the overhang of the filter toggles", () => {
  const lgt = rule(".lgt").match(/margin:\s*0\s+-(\d+(?:\.\d+)?)px/);
  const pad = rule(".panel").match(/padding:\s*\d+px\s+(\d+(?:\.\d+)?)px/);
  assert.ok(lgt && pad);
  assert.ok(Number(lgt[1]) <= Number(pad[1]));
});

test("list labels shrink and long names wrap", () => {
  const r = rule(".item>span:first-child");
  assert.match(r, /min-width:0/);
  assert.match(r, /overflow-wrap:anywhere/);
});

test("panel paragraphs wrap long unbroken text", () => {
  assert.match(rule(".panel p"), /overflow-wrap:anywhere/);
});

test("tour counts stay on one line", () => {
  assert.match(rule(".walk-panel .item .num"), /white-space:nowrap/);
});
