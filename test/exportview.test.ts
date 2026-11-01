import { test } from "node:test";
import assert from "node:assert/strict";
import { bare, exportName, fontCss, pngScale, standalone, themeOf } from "../src/viewer/exportsvg.ts";
import { FONT_FACES } from "../src/viewer/theme.ts";

test("themeOf: a pinned theme wins, else the OS preference", () => {
  assert.equal(themeOf("dark", false), "dark");
  assert.equal(themeOf("light", true), "light");
  assert.equal(themeOf(undefined, true), "dark");
  assert.equal(themeOf(undefined, false), "light");
  assert.equal(themeOf("other", true), "dark");
});

test("exportName slugs the repo and board, caps the length and falls back to board", () => {
  assert.equal(exportName("org/repo", "Web › Pages", "dark", "svg"), "org_repo-Web_Pages-dark.svg");
  assert.equal(exportName("r", "overview", "light", "png"), "r-overview-light.png");
  assert.equal(exportName("..", "x_", "light", "svg"), "-x-light.svg");
  const long = exportName("a".repeat(200), "b", "light", "svg");
  assert.equal(long, `${"a".repeat(80)}-light.svg`);
});

test("pngScale is 2 for normal viewports and under 1 past the canvas limits", () => {
  assert.equal(pngScale(1280, 800), 2);
  assert.equal(pngScale(5000, 5000), Math.sqrt(16e6 / 25e6));
  assert.ok(pngScale(5000, 5000) < 1);
  assert.equal(pngScale(10000, 100), 8192 / 10000);
});

test("bare drops tabindex, role and inert but keeps data-hit and aria-label", () => {
  const out = bare('<g data-hit="n:a" tabindex="0" role="button" aria-label="A" inert=""><text role="img">x</text></g>');
  assert.equal(out, '<g data-hit="n:a" aria-label="A"><text>x</text></g>');
});

test("fontCss declares both embedded families as woff2", () => {
  const css = fontCss("data:font/woff2;base64,AAA", "data:font/woff2;base64,BBB");
  assert.ok(css.includes(`font-family:"${FONT_FACES.display}"`) && css.includes(`font-family:"${FONT_FACES.mono}"`));
  assert.equal(css.split('format("woff2")').length - 1, 2);
});

test("standalone is a well-formed svg with the ground, the ancestor classes and escaped css", () => {
  const s = standalone({ w: 1280, h: 800, label: 'a & b <c> "d"', ground: "#fff", css: ".a>.b{content:'&<'}", classes: "canvas at-story", inner: '<svg class="board"></svg>' });
  assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1280" height="800" viewBox="0 0 1280 800"/);
  assert.ok(s.includes('<rect width="1280" height="800" fill="#fff"/>'));
  assert.ok(s.includes('<g class="canvas at-story"><svg class="board"></svg></g>'));
  assert.ok(s.includes("content:'&amp;&lt;'"));
  assert.ok(s.includes('aria-label="a &amp; b &lt;c&gt; &quot;d&quot;"'));
  assert.ok(s.includes("<title>a &amp; b &lt;c> \"d\"</title>"));
  assert.ok(s.includes("animation:none!important;transition:none!important"));
  assert.ok(s.endsWith("</svg>"));
});

test("the viewer's node shadow is a `.shaded` rule, which the export skips", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/viewer/chrome.css", import.meta.url), "utf8");
  assert.match(css, /svg\.board\.shaded[^{]*\.body\s*\{[^}]*drop-shadow/);
  assert.doesNotMatch(readFileSync(new URL("../src/viewer/board.css", import.meta.url), "utf8"), /drop-shadow/);
  assert.match(readFileSync(new URL("../src/viewer/exportsvg.ts", import.meta.url), "utf8"), /includes\("\.shaded"\)/);
});
