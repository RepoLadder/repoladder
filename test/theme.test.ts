import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES as BRAND } from "@repoladder/brand";
import { FONTS, THEMES, resolveTokens, tokenCss } from "../src/viewer/theme.ts";

const KINDS = ["web", "backend", "library", "scripts", "part", "svc", "store"];
const KEYS = [
  "ground", "surface", "paper", "ink", "muted", "sub", "line", "soft", "accent", "halo", "wire", "call",
  ...KINDS.flatMap((k) => [k, `${k}-line`]), "scrim", "shadow", "float", "float-raised", "accent-ink",
].sort();

function lum(hex: string): number {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  assert.ok(m, `${hex} is not an opaque hex color`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("both themes have the same explicit token keys", () => {
  assert.deepEqual(Object.keys(THEMES.light).sort(), KEYS);
  assert.deepEqual(Object.keys(THEMES.dark).sort(), KEYS);
});

test("brand colors pass through untouched, in valid formats", () => {
  for (const t of ["light", "dark"] as const) {
    for (const [k, v] of Object.entries(BRAND[t])) assert.equal(THEMES[t][k], v, `${t}.${k}`);
    for (const [k, v] of Object.entries(THEMES[t])) assert.match(v, /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba\(/, `${t}.${k}`);
  }
});

test("text on the floating surfaces is readable in both themes", () => {
  for (const t of ["light", "dark"] as const) {
    for (const k of ["float", "float-raised"]) assert.ok(ratio(THEMES[t].ink, THEMES[t][k]) >= 4.5, `${t}: ink on ${k}`);
  }
});

test("text on the accent is readable in both themes", () => {
  for (const t of ["light", "dark"] as const) {
    assert.ok(ratio(THEMES[t].surface, THEMES[t].accent) >= 4.5, `${t}: surface on accent`);
    assert.ok(ratio(THEMES[t]["accent-ink"], THEMES[t].accent) >= 4.5, `${t}: accent-ink on accent`);
  }
});

test("tokenCss carries the local tokens and the dark accent", () => {
  const css = tokenCss();
  assert.ok(css.includes("--scrim:") && css.includes("--shadow:"));
  assert.ok(css.includes(`--accent:${THEMES.dark.accent}`));
});

test("resolveTokens names system stacks unless it is given the page fonts", () => {
  const css = "a{font-family:var(--font-display)}b{font-family:var(--font-mono)}";
  assert.doesNotMatch(resolveTokens(css, "dark"), /Geist/);
  const g = resolveTokens(css, "dark", FONTS);
  assert.ok(g.includes('"Geist",') && g.includes('"Geist Mono"'));
  assert.equal(resolveTokens("c{fill:var(--paper)}", "dark"), `c{fill:${THEMES.dark.paper}}`);
});
