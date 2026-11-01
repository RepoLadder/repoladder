import { test } from "node:test";
import assert from "node:assert/strict";
import { ELEVATION, SHAPE, SPACE, THEMES, TYPE, tokenCss } from "../src/viewer/theme.ts";

const css = tokenCss();
const count = (s: string) => css.split(s).length - 1;
const first = css.slice(0, css.indexOf("}") + 1);

test("the spacing scale is six steps on a 4px grid, emitted once outside the theme blocks", () => {
  assert.equal(Object.keys(SPACE).length, 6);
  for (const [k, v] of Object.entries(SPACE)) {
    assert.match(k, /^space-[1-6]$/);
    assert.equal(parseInt(v, 10) % 4, 0, k);
    assert.equal(count(`--${k}:${v};`), 1, k);
    assert.ok(first.includes(`--${k}:${v};`), k);
  }
});

test("three shadow tiers grow in blur radius; the blur token is off", () => {
  const blur = (k: string) => Number(ELEVATION[k as keyof typeof ELEVATION].match(/^0 \d+px (\d+)px/)![1]);
  assert.ok(blur("shadow-1") < blur("shadow-2") && blur("shadow-2") < blur("shadow-3"));
  for (const k of ["shadow-1", "shadow-2", "shadow-3"]) assert.equal(count(`--${k}:`), 1, k);
  assert.ok(first.includes("--float-blur:0px;"));
  assert.equal(count("--float-blur:"), 1);
});

test("the nested radius is smaller than the card radius", () => {
  assert.equal(SHAPE["radius-sm"], "8px");
  assert.ok(first.includes("--radius-sm:8px;"));
});

test("both floating surface tiers are in the light block and in both dark blocks", () => {
  for (const k of ["float", "float-raised"]) {
    assert.equal(count(`--${k}:`), 3, k);
    assert.ok(first.includes(`--${k}:${THEMES.light[k]};`), k);
  }
});

test("the new tokens stay out of the type scale and the theme color keys", () => {
  assert.equal(Object.keys(TYPE).length, 8);
  assert.ok(!Object.keys(THEMES.light).some((k) => k.startsWith("space-") || k.startsWith("shadow-") || k === "float-blur"));
});
