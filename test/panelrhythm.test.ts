import assert from "node:assert/strict";
import { test } from "node:test";
import { viewerAssets } from "../src/build/viewer.ts";
import { idRow } from "../src/viewer/idchip.ts";
import { foots, keyCard, keyClosed, setKeyClosed } from "../src/viewer/keycard.ts";

const css = () => viewerAssets().css;

test("the side panel is a flex column with one gap and no special-case margins", () => {
  assert.match(css(), /#details\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;\s*gap:\s*24px/);
  for (const s of ["#details > h2:not(:first-child)", "#details > .panel + .legend", "#details > .walk + .legend", "#details > .foot"]) assert.ok(!css().includes(s), s);
});

test("the Key card is a details open by default", () => {
  const h = keyCard("<li>a</li>");
  assert.ok(/<details class="panel box key" open>/.test(h));
  assert.ok(h.includes("<summary>Key</summary>") && h.includes('<div class="box-body"><ul class="legend"><li>a</li></ul></div>'));
});

test("a close is remembered across re-renders and a reopen too", () => {
  try {
    setKeyClosed(true);
    assert.ok(keyClosed() && !/ open/.test(keyCard("<li>a</li>")));
    setKeyClosed(false);
    assert.ok(/<details class="panel box key" open>/.test(keyCard("<li>a</li>")));
  } finally { setKeyClosed(false); }
});

test("foots groups the notes, or nothing", () => {
  assert.equal(foots(), "");
  assert.equal(foots("", ""), "");
  assert.equal(foots("<p>a</p>", "", "<p>b</p>"), '<div class="foots"><p>a</p><p>b</p></div>');
});

test("the id row keeps its markup and wraps by CSS", () => {
  const h = idRow("x");
  assert.ok(h.startsWith('<p class="idrow"><code>x</code>') && h.includes("data-copy") && h.includes("data-link"));
  assert.match(css(), /\.idrow code\{[^}]*min-width:0/);
  const lb = css().match(/\.linkbox\{[^}]*margin:([^;}]+)/)?.[1] ?? "";
  assert.ok(lb && !lb.includes("-"), lb);
});
