import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, TYPE, tokenCss } from "../src/viewer/theme.ts";

const dir = new URL("../src/viewer/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");

// Diagram and canvas text is sized by the box-size model, not the chrome scale; .counts b is the one stat numeral.
const ALLOW = new Set([".counts b", ".at-story svg.board .node .name", ".captions .cap", ".node.file .name", ".node.file .ex"]);

/** Every [selector, size token] pair for font-size and font shorthands. */
function sizes(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split(/\s*,\s*/).pop()!.replace(/^[\s\S]*\}/, "").trim();
    for (const d of m[2].split(";")) {
      const [prop, ...rest] = d.split(":");
      const v = rest.join(":").trim();
      if (prop.trim() === "font-size") out.push([sel, v]);
      else if (prop.trim() === "font") {
        const t = v.match(/(?:^|\s)(var\(--text-\w+\)|\d[\d.]*(?:px|em|rem|%)|inherit)(?=\/|\s|,|$)/);
        if (t && t[1] !== "inherit") out.push([sel, t[1]]);
      }
    }
  }
  return out;
}

test("every chrome font size uses the type scale", () => {
  let seen = 0;
  for (const f of ["styles.css", "walk.css", "dial.css"]) {
    for (const [sel, size] of sizes(read(f))) {
      seen++;
      if (ALLOW.has(sel)) continue;
      assert.ok(/^var\(--text-(micro|small|body|lg|h3)\)$|^inherit$|^[\d.]+(em|%)$/.test(size), `${f} ${sel}: ${size}`);
    }
  }
  assert.ok(seen > 40);
});

test("tokenCss emits the scale once, outside the theme blocks", () => {
  const css = tokenCss();
  const first = css.slice(0, css.indexOf("}") + 1);
  for (const [k, v] of Object.entries({ micro: 12, small: 14, body: 16, lg: 18, h3: 20 })) {
    assert.equal(css.split(`--text-${k}:${v}px;`).length - 1, 1, k);
    assert.ok(first.includes(`--text-${k}:${v}px;`), k);
  }
  for (const k of ["micro", "small", "body"]) assert.equal(css.split(`--lh-${k}:`).length - 1, 1, k);
  assert.equal(Object.keys(TYPE).length, 8);
});

test("the type scale is not a theme group", () => {
  assert.ok(!Object.keys(THEMES.light).some((k) => k.startsWith("text-") || k.startsWith("lh-")));
});

test("the search input stays at least 16px (iOS focus zoom)", () => {
  assert.ok(/\.sbox input\{[^}]*font-size:var\(--text-body\)|\.sbox input \{[^}]*font-size: var\(--text-body\)/.test(read("styles.css")));
  assert.equal(TYPE["text-body"], "16px");
});
