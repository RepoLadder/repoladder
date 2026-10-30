import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { keyCard, notesBox } from "../src/viewer/keycard.ts";

test("notesBox is nothing without notes", () => {
  assert.equal(notesBox(), "");
  assert.equal(notesBox("", ""), "");
});

test("notesBox is one collapsed box wrapping the non-empty parts in order", () => {
  const out = notesBox("<p>a</p>", "", `<button class="open" data-sel="n:x">x</button>`);
  assert.ok(out.startsWith('<details class="panel box notes">'));
  assert.ok(!/<details[^>]* open/.test(out));
  assert.ok(out.includes("<summary>Notes</summary>"));
  assert.ok(out.includes('<div class="foots"><p>a</p><button class="open" data-sel="n:x">x</button></div>'));
});

test("the Key is the only box matching details.key", () => {
  assert.match(keyCard("<li>r</li>"), /<details class="panel box key"/);
  assert.ok(!notesBox("<p>a</p>").includes("key"));
});

test("the boilerplate line is gone", () => {
  for (const f of ["panels.ts", "story.ts"]) assert.ok(!readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8").includes("comes from the code"), f);
});

test("a normal build carries no lab stamp markup", async () => {
  const { fileURLToPath } = await import("node:url");
  const { analyze } = await import("../src/analyze/index.ts");
  const { renderHtml } = await import("../src/build/html.ts");
  const { assign, defaultGrouping } = await import("../src/model/grouping.ts");
  const { buildModel } = await import("../src/model/rollup.ts");
  const facts = analyze(fileURLToPath(new URL("./fixtures/basic-app", import.meta.url)));
  const g = defaultGrouping(facts);
  const html = renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
  assert.ok(!html.includes("labstamp"));
});
