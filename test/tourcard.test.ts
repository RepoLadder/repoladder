import { test } from "node:test";
import assert from "node:assert/strict";
import { cardHtml, dotsHtml, navHtml } from "../src/viewer/tourcard.ts";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("dotsHtml: one dot per step, one current, the passed ones done", () => {
  const h = dotsHtml(5, 2);
  assert.equal(count(h, /<i[ >]/g), 5);
  assert.equal(count(h, /class="on"/g), 1);
  assert.equal(count(h, /class="done"/g), 2);
  assert.match(h, /aria-hidden="true"/);
});

test("navHtml: Skip, Back, Next in order; none on the last step, where Done leaves", () => {
  const mid = navHtml(1, 3);
  assert.match(mid, /data-tour-exit aria-label="Leave the tour">Skip</);
  assert.ok(mid.indexOf("data-tour-exit") < mid.indexOf('data-tour-step="-1"') && mid.indexOf('data-tour-step="-1"') < mid.indexOf('data-tour-step="1"'));
  assert.match(mid, /class="primary">Next/);
  assert.doesNotMatch(mid, /disabled/);
  assert.match(navHtml(0, 3), /data-tour-step="-1" disabled/);
  const last = navHtml(2, 3);
  assert.doesNotMatch(last, /data-tour-exit|Skip/);
  assert.match(last, /class="primary">Done</);
});

test("cardHtml keeps its id and classes, and escapes the text", () => {
  const h = cardHtml({ i: 0, n: 2, title: "<b>t</b>", caption: '"><img src=x>', notes: [["<n>", "<m>"]], undrawn: [["<a>", "b"]] });
  assert.match(h, /^<div id="tour" class="panel tour-card walk-card" aria-live="polite">/);
  assert.match(h, /Step 1 of 2 · &lt;b&gt;t&lt;\/b&gt;/);
  assert.doesNotMatch(h, /<img|<b>t|<n>|<a>/);
  assert.match(h, /rd-note/);
  assert.match(h, /rd-undrawn/);
});
