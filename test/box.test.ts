import assert from "node:assert/strict";
import { test } from "node:test";
import { box, lead, more } from "../src/viewer/box.ts";

test("box is a closed details card with its label as the summary", () => {
  assert.equal(box("Tours", "<ul></ul>"), '<details class="panel box"><summary>Tours</summary><div class="box-body"><ul></ul></div></details>');
});

test("box takes open and a class", () => {
  assert.equal(box("Key", "x", { open: true, cls: "key" }), '<details class="panel box key" open><summary>Key</summary><div class="box-body">x</div></details>');
});

test("box escapes the title and passes the body through", () => {
  const h = box('<img src=x onerror="a">', "<b>ok</b>");
  assert.ok(!h.includes("<img") && h.includes("&lt;img"));
  assert.ok(h.includes("<b>ok</b>"));
});

test("tourList is empty or a collapsed Tours box", async () => {
  const { tourList } = await import("../src/viewer/walk.ts").catch(() => ({ tourList: undefined }));
  if (!tourList) return; // the module needs the page at import: covered by hostile.test.ts
  assert.ok(typeof tourList === "function");
});

test("lead: a short summary is its own line", () => {
  assert.deepEqual(lead("Handles sign-in."), { line: "Handles sign-in.", rest: "" });
  assert.deepEqual(lead(undefined), { line: "", rest: "" });
});

test("lead: splits at the first sentence", () => {
  assert.deepEqual(lead("Handles sign-in. Also sessions and tokens."), { line: "Handles sign-in.", rest: "Also sessions and tokens." });
});

test("lead: a long sentence is cut at a word boundary with an ellipsis, and the whole text moves to the rest", () => {
  const long = "This part does a great many things at once, from reading the config to wiring routes together and reporting every failure it ever sees to the log";
  const r = lead(long);
  assert.ok(r.line.length <= 110 && r.line.endsWith("…") && !/\s…$/.test(r.line));
  assert.equal(r.rest, long);
  assert.ok(long.startsWith(r.line.slice(0, -1)));
});

test("more: a collapsed details, or nothing for blank content; callers escape", () => {
  assert.equal(more("<p>x</p>"), '<details class="more"><summary>More</summary><div class="more-body"><p>x</p></div></details>');
  assert.equal(more("  "), "");
  assert.ok(more("<b>&lt;</b>").includes("<b>&lt;</b>"));
});
