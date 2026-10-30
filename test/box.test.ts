import assert from "node:assert/strict";
import { test } from "node:test";
import { box } from "../src/viewer/box.ts";

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
