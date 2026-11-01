import assert from "node:assert/strict";
import { test } from "node:test";
import { viewerAssets } from "../src/build/viewer.ts";

const css = viewerAssets().css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]!.trim() }));

test("a filled button pairs the accent fill with --accent-ink, never --surface", () => {
  const filled = rules.filter((r) => /(button|\.open)/.test(r.sel) && !/:hover/.test(r.sel) && /background:\s*var\(--accent\)/.test(r.body));
  assert.ok(filled.length >= 2);
  for (const r of filled) {
    assert.match(r.body, /color:\s*var\(--accent-ink\)/, r.sel);
    assert.ok(!/(^|;)\s*color:\s*var\(--surface\)/.test(r.body), r.sel);
  }
});

test("disabled buttons share one look and no .4 variant remains", () => {
  const dis = rules.filter((r) => /button:disabled|\.sbtn:disabled/.test(r.sel) && /\.hist button:disabled/.test(r.sel));
  assert.equal(dis.length, 1);
  assert.match(dis[0]!.body, /opacity:\s*\.5/);
  assert.match(dis[0]!.body, /pointer-events:\s*none/);
  for (const r of rules) if (/button:disabled/.test(r.sel) && r !== dis[0]) assert.ok(!/opacity|color:/.test(r.body), r.sel);
  assert.ok(!/button[^{}]*:disabled[^{}]*\{[^}]*opacity:\s*\.4/.test(css));
});

test("coarse pointers get 44px targets for the shared skin", () => {
  assert.match(css, /@media\s*\(pointer:\s*coarse\)\s*\{[^@]*?\.hist button\{min-height:\s*44px/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)\s*\{[^@]*?\.tbact,[^{}]*\.hist button\{min-height:\s*44px/);
  const tb = rules.find((r) => r.sel === ".tbact:disabled");
  assert.ok(tb && /opacity:\s*\.5/.test(tb.body) && /pointer-events:\s*none/.test(tb.body), "top-bar actions share the disabled look");
});

test("the inspector toggle is 44px for coarse pointers", () => {
  assert.match(css, /pointer:\s*coarse\)\s*\{html:not\(\.embed\) #insp\{width:\s*44px;height:\s*44px/);
});

test("the skin block uses tokens only", () => {
  const skin = rules.filter((r) => /^\.tour-nav button[,:]/.test(r.sel.replace(/\s+/g, " ")));
  assert.ok(skin.length >= 3);
  for (const r of skin) assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(r.body), r.sel);
});
