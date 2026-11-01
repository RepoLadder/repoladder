import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isEmbed, pickTop, stripEmbed } from "../src/viewer/embed.ts";
import { viewerCss } from "./helpers/viewercss.ts";

test("isEmbed is on only for embed=1", () => {
  assert.equal(isEmbed("?embed=1"), true);
  assert.equal(isEmbed("?a=2&embed=1"), true);
  for (const s of ["", "?embed=0", "?x=embed=1", "?embed=11"]) assert.equal(isEmbed(s), false, s);
});

test("stripEmbed drops only embed and keeps other params and the hash", () => {
  assert.equal(stripEmbed("https://x/y?a=1&embed=1#v"), "https://x/y?a=1#v");
  assert.equal(stripEmbed("https://x/y?embed=1"), "https://x/y");
  assert.equal(stripEmbed("https://x/y?embed=1#b.c"), "https://x/y#b.c");
  assert.equal(stripEmbed("https://x/y"), "https://x/y");
  assert.equal(stripEmbed("not a url"), "not a url");
});

test("pickTop measures from the toolbar when embedded, else the header", () => {
  assert.equal(pickTop(true, 0, 44), 44);
  assert.equal(pickTop(false, 60, 44), 60);
});

test("embed CSS hides the title bar and the footer", () => {
  const css = viewerCss();
  const rule = css.match(/html\.embed header,\s*html\.embed \.made\s*\{([^}]*)\}/);
  assert.ok(rule && /display:\s*none/.test(rule[1]));
});
