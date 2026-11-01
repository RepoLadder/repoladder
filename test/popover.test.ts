import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerAssets } from "../src/build/viewer.ts";

const POPOVERS = [".tour-card", ".crumbmenu", ".bmenu", ".xmenu", ".xnote", ".fbar", ".sbox"];
const rules = (): { sel: string[]; body: string }[] =>
  [...viewerAssets().css.matchAll(/(?:^|(?<=[}]))\s*([^{}@][^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.split(",").map((s) => s.trim()), body: m[2]! }));

test("one grouped rule gives every popover its surface, border, radius and shadow", () => {
  const shared = rules().find((r) => POPOVERS.every((p) => r.sel.includes(p)) && /box-shadow:/.test(r.body));
  assert.ok(shared, "grouped rule");
  for (const d of ["background:", "border:", "border-radius:", "box-shadow:"]) assert.ok(shared.body.includes(d), d);
});

test("no popover redeclares its own surface, border, radius or shadow", () => {
  for (const r of rules()) {
    if (POPOVERS.every((p) => r.sel.includes(p))) continue;
    if (r.sel.length !== 1 || !POPOVERS.includes(r.sel[0]!)) continue;
    assert.doesNotMatch(r.body, /(?:^|;)\s*(?:background|border|border-radius|box-shadow)\s*:/, r.sel.join());
  }
});

test("the open motion is opacity and transform only, and off under reduced motion", () => {
  const css = viewerAssets().css;
  const kf = css.match(/@keyframes pop-in\{([^@]*?\}\})/)?.[1] ?? "";
  assert.ok(kf, "keyframes");
  const props = [...kf.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
  assert.ok(props.length > 0 && props.every((p) => p === "opacity" || p === "transform"), props.join());
  assert.match(css, /animation:pop-in \.15s ease-out/);
  assert.match(css, /@media ?\(prefers-reduced-motion: ?reduce\)\{\.tour-card[^@]*animation:none/);
});
