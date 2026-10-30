import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPYRIGHT_HOLDER, COPYRIGHT_YEAR, EXTERNALS, bundledPackages, generateNotices, noticeText } from "../scripts/legal.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const AGAIN = "run `npm run legal`";

test("LICENSE is the Apache-2.0 text and ships with the plugin", () => {
  const l = read("LICENSE");
  assert.ok(l.trimStart().startsWith("Apache License"));
  assert.ok(l.includes("Version 2.0, January 2004"));
  assert.ok(l.includes("END OF TERMS AND CONDITIONS"));
  assert.equal(read("plugin/LICENSE"), l);
});

test("NOTICE names the holder, keeps the Geist credit, and matches the generator", () => {
  const n = read("NOTICE");
  assert.equal(n, noticeText(), AGAIN);
  assert.ok(n.includes(`Copyright ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER}`));
  assert.ok(n.includes("Copyright 2024 The Geist Project Authors"));
  assert.equal(read("plugin/NOTICE"), n);
});

test("THIRD-PARTY-NOTICES.txt matches the generator and ships with the plugin", async () => {
  const t = read("THIRD-PARTY-NOTICES.txt");
  assert.equal(t, await generateNotices(), AGAIN);
  assert.equal(read("plugin/THIRD-PARTY-NOTICES.txt"), t);
});

test("the notices' full-text sections are exactly the bundled packages (plus esbuild's helpers)", async () => {
  const t = read("THIRD-PARTY-NOTICES.txt");
  const credits = t.indexOf("Credits (not bundled)");
  const sections = (s: string) => [...s.matchAll(/^--- (\S+) \(/gm)].map((m) => m[1]).sort();
  const want = [...new Set([...(await bundledPackages()), "esbuild"])].sort();
  assert.deepEqual(sections(t.slice(0, credits)), want);
  for (const c of ["typescript", "@terrastruct/d2", "elkjs", "Geist"]) assert.ok(t.slice(credits).includes(`--- ${c}`), c);
});

test("the externals in scripts/bundle.ts are the credited, unbundled packages", () => {
  const src = read("scripts/bundle.ts");
  const found = [...src.matchAll(/external: \[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).join(","));
  assert.ok(found.length >= 2);
  for (const f of found) assert.equal(f, EXTERNALS.join(","));
});

test("root and plugin package.json declare Apache-2.0", () => {
  assert.equal(JSON.parse(read("package.json")).license, "Apache-2.0");
  assert.equal(JSON.parse(read("plugin/package.json")).license, "Apache-2.0");
});
