import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewerCss } from "./helpers/viewercss.ts";

const src = (f: string) => readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8");

test("a lit or selected arrow gets an accent arrowhead, only on the ends it already has (#281)", () => {
  assert.match(src("draw.ts"), /marker\("lit", "lit"\)/, "the board defines #arw-lit");
  assert.match(src("board.css"), /\.arw\.lit \{\s*fill: var\(--accent\);/);
  const walk = src("walk.css");
  for (const end of ["end", "start"]) {
    const rule = new RegExp(`svg\\.walking g\\.wire\\.wk-now \\.line\\[marker-${end}\\],\\s*g\\.sel \\.line\\[marker-${end}\\] \\{\\s*marker-${end}: url\\(#arw-lit\\);`);
    assert.match(walk, rule, `marker-${end} swaps for lit and selected wires`);
  }
  // an unconditional swap would add an arrowhead to a store board's read-only (or write-only) wire
  assert.doesNotMatch(walk + viewerCss(), /\.line \{\s*marker-(end|start):/);
});

test("lit and selected extra wires are drawn at full opacity; the rest keep 0.75 (#281)", () => {
  const css = viewerCss();
  assert.match(css, /\.wire\.xw \.line \{\s*stroke-width: 1\.25;\s*opacity: 0\.75;/);
  // four classes: beats board.css's `.wire.svc .line { opacity: .75 }` (three) for a lit "uses" wire
  assert.match(css, /\.wire\.xw:is\(\.sel, \.wk-now\) \.line \{\s*opacity: 1;/);
  assert.match(src("board.css"), /\.wire\.svc \.line \{[^}]*opacity: \.75;/);
});
