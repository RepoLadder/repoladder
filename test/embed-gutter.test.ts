import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/viewer/styles.css", import.meta.url), "utf8").replace(/\s+/g, " ");

test("embedded body takes the 24px site gutter above the phone layout", () => {
  const m = css.match(/@media \(min-width: 761px\) \{ html\.embed \{ --gutter: 24px; \} html\.embed body \{ padding-inline: var\(--gutter\); \} \}/);
  assert.ok(m, "min-width 761px block with --gutter and padding-inline");
});

test("the standalone body keeps its 20px side padding", () => {
  assert.match(css, /body \{[^}]*padding-inline: 20px;[^}]*\}/);
});

test("the phone layout still sets body padding-inline to 0", () => {
  assert.match(css, /@media \(max-width: 760px\) \{ html, body \{ overflow: hidden; \} body \{ height: 100dvh; padding-inline: 0;/);
});
