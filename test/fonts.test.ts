import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageFonts } from "../src/build/filepack.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { EXPORT_FONTS, FONTS, FONT_FACES } from "../src/viewer/theme.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p));
const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const g = defaultGrouping(facts);
const page = renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});

test("the page makes no third-party font request", () => {
  assert.ok(!/googleapis|gstatic/.test(page), "no Google Fonts reference");
  assert.deepEqual(page.match(/<link[^>]*>/g)?.map((l) => /^<link rel="icon" type="image\/svg\+xml" href="data:/.test(l)), [true], "no <link> element but the data-URI favicon");
});

test("the font blob holds the committed subsets and the full OFL text", () => {
  const f = pageFonts(page)!;
  assert.deepEqual(Buffer.from(f.sans), read("src/viewer/fonts/geist.woff2"));
  assert.deepEqual(Buffer.from(f.mono), read("src/viewer/fonts/geist-mono.woff2"));
  for (const b of [f.sans, f.mono]) assert.equal(Buffer.from(b.subarray(0, 4)).toString(), "wOF2");
  assert.equal(f.license, read("LICENSE-Geist.txt").toString());
  assert.ok(f.license.includes("SIL OPEN FONT LICENSE Version 1.1") && f.license.includes("Copyright 2024 The Geist Project Authors"));
  assert.match(page, /<!-- Geist and Geist Mono: Copyright 2024 The Geist Project Authors, SIL Open Font License 1\.1/);
});

test("page stacks lead with the registered family names; exports name no page family", () => {
  assert.ok(FONTS.display.startsWith(`"${FONT_FACES.display}",`) && FONTS.mono.startsWith(`"${FONT_FACES.mono}",`));
  assert.ok(FONTS.ui.startsWith(`"${FONT_FACES.display}",`));
  assert.ok(FONTS.ui.includes("system-ui"), "the UI keeps a system fallback for glyphs the subset lacks");
  for (const v of Object.values(EXPORT_FONTS)) assert.ok(!v.includes("Geist"));
});

test("the licence and notice ship with the plugin, byte for byte", () => {
  for (const f of ["LICENSE-Geist.txt", "NOTICE", "LICENSE", "THIRD-PARTY-NOTICES.txt"]) assert.deepEqual(read(`plugin/${f}`), read(f), f);
});

test("no source still names the old fonts", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(root, dir))) {
      const p = `${dir}/${f}`;
      if (statSync(join(root, p)).isDirectory()) { if (f !== "fonts") walk(p); continue; }
      if (p === "scripts/fonts.ts" || !/\.(ts|css|md)$/.test(f)) continue;
      if (/Bricolage|JetBrains|GOOGLE_FONTS/.test(read(p).toString())) hits.push(p);
    }
  };
  walk("src");
  walk("scripts");
  assert.deepEqual(hits, []);
});
