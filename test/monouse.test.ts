import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { metaHtml, mono } from "../src/viewer/mono.ts";

const dir = join(fileURLToPath(new URL(".", import.meta.url)), "../src/viewer");

/** Selectors whose declarations use the mono face, across every viewer stylesheet. */
function monoSelectors(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".css"))) {
    const css = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // rules at depth 0 or nested one level (inside @media): "selectors { body }" with no inner braces
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[2]!.includes("--font-mono")) continue;
      const sel = m[1]!.trim();
      if (sel.startsWith("@")) continue;
      for (const s of sel.split(",")) out.add(s.trim().replace(/\s+/g, " "));
    }
  }
  return out;
}

const ALLOWED = [
  "section h2", ".panel h4", ".box > summary", ".ev", ".idrow code", ".cname", ".fname", ".linkbox", ".snip", ".sbtn kbd", ".captions .cap", ".mono",
  ".node.file .ex", ".node .sub", ".node .glyph", ".wire .n", "#ask .cite",
];

test("mono is used only by the allowed selectors", () => {
  const got = monoSelectors();
  const extra = [...got].filter((s) => !ALLOWED.includes(s));
  const missing = ALLOWED.filter((s) => !got.has(s));
  assert.deepEqual({ extra, missing }, { extra: [], missing: [] });
});

test("counts, meta and badges are not mono", () => {
  const got = monoSelectors();
  for (const s of [".num", ".meta", ".counts span", ".beat .bn", ".dtext"]) assert.ok(!got.has(s), `${s} must not be mono`);
});

test("metaHtml puts only the sha in mono and escapes", () => {
  assert.equal(metaHtml("5 parts · 683 files", "b8f2857"), '5 parts · 683 files · <span class="mono">b8f2857</span>');
  assert.equal(metaHtml("a<b & \"c\"", null), "a&lt;b &amp; &quot;c&quot;");
  assert.ok(metaHtml("x", "<s>'").includes("&lt;s&gt;&#39;"));
  const plain = "5 parts · 683 files";
  assert.equal(metaHtml(plain, "abc").replace(/<[^>]+>/g, ""), `${plain} · abc`);
});

test("mono escapes", () => {
  assert.equal(mono("a<b"), '<span class="mono">a&lt;b</span>');
});
