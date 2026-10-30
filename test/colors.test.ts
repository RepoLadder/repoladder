import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type TS from "typescript";

const ts: typeof TS = createRequire(import.meta.url)("typescript");
const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\s*\(/g;
// "<file>: <literal>" -> why it is not a color. Never use this for a real color.
const ALLOW: Record<string, string> = {
  "src/build/mark.ts: #12805F": "generated verbatim copy of the brand mark (src/build/mark*.svg), not a design color",
  "src/build/mark.ts: #151918": "generated verbatim copy of the brand mark (src/build/mark*.svg), not a design color",
  "src/build/mark.ts: #34D399": "generated verbatim copy of the brand mark (src/build/mark*.svg), not a design color",
  "src/build/mark.ts: #F2F4F3": "generated verbatim copy of the brand mark (src/build/mark*.svg), not a design color",
  "scripts/shellstyle.ts: #2E7D4F": "lab/gallery status hue; @repoladder/brand has no good/warn token",
  "scripts/shellstyle.ts: #A0611B": "lab/gallery status hue; @repoladder/brand has no good/warn token",
  "scripts/shellstyle.ts: #6CC58F": "lab/gallery status hue; @repoladder/brand has no good/warn token",
  "scripts/shellstyle.ts: #E0A75E": "lab/gallery status hue; @repoladder/brand has no good/warn token",
};

const cssColors = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").match(COLOR) ?? [];

function tsColors(text: string, file: string): string[] {
  const out: string[] = [];
  const walk = (n: TS.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(...(n.text.match(COLOR) ?? []));
    ts.forEachChild(n, walk);
  };
  walk(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return out;
}

test("the scanner catches literals and skips comments", () => {
  assert.equal(cssColors("a{color:#0005} /* (#145) */ b{fill:rgba(0,0,0,.1)}").length, 2);
  assert.equal(cssColors("a{fill:transparent;stroke:currentColor;outline:none}").length, 0);
  const sample = 'const a = "#fff"; // see #211\nconst b = `x${a}rgb(1,2,3)`;';
  assert.equal(tsColors(sample, "x.ts").length, 2);
});

test("viewer and build files use tokens, not colors", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const found: string[] = [];
  for (const dir of ["src/viewer", "src/build"]) {
    for (const f of readdirSync(`${root}${dir}`, { recursive: true, encoding: "utf8" })) {
      const rel = `${dir}/${f.replaceAll("\\", "/")}`;
      if (rel === "src/viewer/theme.ts") continue;
      const text = f.endsWith(".css") || f.endsWith(".ts") ? readFileSync(`${root}${rel}`, "utf8") : null;
      if (text === null) continue;
      for (const c of f.endsWith(".css") ? cssColors(text) : tsColors(text, rel)) found.push(`${rel}: ${c}`);
    }
  }
  assert.deepEqual(found.filter((x) => !(x in ALLOW)), [], "add a token in src/viewer/theme.ts (or @repoladder/brand)");
});

// scripts/shots.ts stays out of this scan: its side-by-side PNG composite (a fixed screenshot canvas) keeps its own colors.
test("lab, gallery and shot-sheet shells take their palette from the brand", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const found: string[] = [];
  for (const rel of ["scripts/gallery.ts", "scripts/shellstyle.ts"]) {
    for (const c of tsColors(readFileSync(`${root}${rel}`, "utf8"), rel)) found.push(`${rel}: ${c}`);
  }
  assert.deepEqual(found.filter((x) => !(x in ALLOW)), [], "use a var(--…) from scripts/shellstyle.ts (palette lives in @repoladder/brand)");
});
