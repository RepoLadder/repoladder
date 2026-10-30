import { test } from "node:test";
import assert from "node:assert/strict";
import { communities, linksAmong } from "../src/model/communities.ts";
import { assign, defaultGrouping, groupingScore, prefixOf } from "../src/model/grouping.ts";
import type { Facts, GroupNode } from "../src/model/schema.ts";
import { DIGEST_TOKEN_BUDGET, LARGE_REPO_MARKER, estimateTokens, summarize } from "../src/model/summary.ts";
import { measure, renderIndex, type Result } from "../scripts/gallery.ts";

const facts = (files: string[], imports: [string, string][], packages?: Facts["packages"]): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: packages ?? [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: packages ? packages.find((p) => path.startsWith(`${p.dir}/`))!.id : "app", loc: 10 })),
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" as const })),
  externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const leaves = (ns: GroupNode[]): GroupNode[] => ns.flatMap((n) => (n.files ? [n] : leaves(n.children!)));

test("communities: two tight clusters joined by one import split apart, deterministically", () => {
  const a = ["a1", "a2", "a3", "a4"], b = ["b1", "b2", "b3", "b4"];
  const clique = (xs: string[]) => xs.flatMap((x, i) => xs.slice(i + 1).map((y) => ({ from: x, to: y })));
  const links = [...clique(a), ...clique(b), { from: "a1", to: "b1" }];
  const got = communities([...a, ...b, "lonely"], links);
  assert.deepEqual(got, [a, b, ["lonely"]]);
  assert.deepEqual(communities([...a, ...b, "lonely"], links), got);
});

test("linksAmong: files that use the same outside file are linked; widely used files are not", () => {
  const files = ["p/A", "p/B", "p/C", "p/D", "p/E", "p/F", "p/G", "p/H", "p/I", "p/J", "p/K", "p/L"];
  const imports = [
    { from: "p/A", to: "c/billing" }, { from: "p/B", to: "c/billing" },
    ...files.map((f) => ({ from: f, to: "c/firebase" })), // everyone: says nothing
    { from: "p/C", to: "p/D" },
  ];
  const links = linksAmong(files, imports);
  assert.ok(links.some((l) => l.from === "p/A" && l.to === "p/B"));
  assert.ok(links.some((l) => l.from === "p/C" && l.to === "p/D" && l.w === 2));
  assert.equal(links.length, 2);
});

test("default grouping splits a big flat folder into import clusters instead of one catch-all", () => {
  // 3 features of 10 files each, side by side in one folder with unhelpful names
  const files: string[] = [];
  const imports: [string, string][] = [];
  for (const [k, feature] of ["Invoice", "Calendar", "Chat"].entries()) {
    // no shared prefixes, so only the imports can tell the features apart
    const fs = Array.from({ length: 10 }, (_, i) => `src/${String.fromCharCode(97 + k * 10 + (i % 10) - (k * 10 + i >= 26 ? 26 : 0))}${"xyzw"[i % 4]}${feature}${i}.ts`);
    files.push(...fs);
    for (let i = 1; i < fs.length; i++) imports.push([fs[i], fs[0]], [fs[i], fs[i - 1]]);
  }
  const f = facts(files, imports);
  const g = defaultGrouping(f);
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  const score = groupingScore(a.leafOf);
  assert.equal(score.groups, 3);
  assert.equal(score.largestShare, 0.333);
  assert.equal(score.singleFileGroups, 0);
  const names = leaves(g.children).map((l) => l.name).sort();
  assert.deepEqual(names, ["Calendar", "Chat", "Invoice"]); // the word the cluster's file names share
  assert.deepEqual(defaultGrouping(f), g);
});

test("default grouping names import clusters no file dominates after their folder, not their first file (#283)", () => {
  const locs = ["ar", "az", "be", "bg", "ca", "cs", "da", "de", "en", "eo", "es", "fa", "fi", "fr", "he", "hu", "hy", "id", "is", "it", "ja", "ka", "km", "ko", "lt", "mk", "ms", "nl", "no", "pl"];
  const files = [...locs.map((l) => `src/locales/${l}.ts`), "src/core/util.ts", "src/core/errors.ts", "src/core/api.ts", "src/app.ts"];
  const imports: [string, string][] = [["src/app.ts", "src/core/api.ts"], ["src/core/api.ts", "src/core/util.ts"]];
  // each locale imports its half's helper and the next locale: no file is imported by most of a cluster
  for (let i = 0; i < locs.length; i++) {
    imports.push([`src/locales/${locs[i]}.ts`, i < 15 ? "src/core/util.ts" : "src/core/errors.ts"]);
    if (i % 15 !== 14) imports.push([`src/locales/${locs[i]}.ts`, `src/locales/${locs[i + 1]}.ts`]);
  }
  const f = facts(files, imports);
  const g = defaultGrouping(f);
  const clusters = leaves(g.children).filter((l) => l.summary.startsWith("Files that import each other"));
  assert.ok(clusters.length >= 2);
  // the folder is the parent's name: " core", numbered among siblings
  assert.deepEqual(clusters.map((c) => c.name), clusters.map((_, i) => (i ? `Locales core ${i + 1}` : "Locales core")));
  for (const c of clusters) assert.match(c.summary, /, in src\/locales\/\.$/);
});

test("default grouping: zod's locales (index.ts imports each, each imports core/util) are never named after one locale (#283)", () => {
  const locs = ["ar", "az", "be", "bg", "ca", "cs", "da", "de", "en", "eo", "es", "fa", "fi", "fr", "he", "hu", "hy", "id", "is", "it", "ja", "ka", "km", "ko", "lt", "mk", "ms", "nl", "no", "pl"];
  const files = [...locs.map((l) => `src/v4/locales/${l}.ts`), "src/v4/locales/index.ts", "src/v4/core/util.ts", "src/v4/core/api.ts", "src/v4/core/errors.ts"];
  const imports: [string, string][] = [["src/v4/core/api.ts", "src/v4/core/util.ts"], ["src/v4/core/errors.ts", "src/v4/core/util.ts"]];
  for (const l of locs) imports.push(["src/v4/locales/index.ts", `src/v4/locales/${l}.ts`], [`src/v4/locales/${l}.ts`, "src/v4/core/util.ts"]);
  const names = (function walk(ns: GroupNode[]): string[] { return ns.flatMap((n) => [n.name, ...walk(n.children ?? [])]); })(defaultGrouping(facts(files, imports)).children);
  for (const l of locs) assert.ok(!names.some((n) => n.toLowerCase() === l), `${l} in ${names}`);
});

test("default grouping folds a one-file leftover into the group it imports", () => {
  const files = [
    ...Array.from({ length: 8 }, (_, i) => `src/billing/b${i}.ts`),
    ...Array.from({ length: 8 }, (_, i) => `src/kiosk/k${i}.ts`),
    "src/stray.ts",
  ];
  const f = facts(files, [["src/stray.ts", "src/kiosk/k1.ts"], ["src/stray.ts", "src/kiosk/k2.ts"]]);
  const g = defaultGrouping(f);
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  assert.equal(groupingScore(a.leafOf).singleFileGroups, 0);
  assert.equal(a.leafOf.get("src/stray.ts"), a.leafOf.get("src/kiosk/k1.ts"));
});

test("a one-file leftover joins the group it imports, not the one that imports it more (#225)", () => {
  const files = [
    ...["a", "b", "c"].flatMap((d) => Array.from({ length: 8 }, (_, i) => `src/${d}/${d}${i}.ts`)),
    "src/entry.ts",
  ];
  const f = facts(files, [["src/entry.ts", "src/a/a1.ts"], ["src/b/b1.ts", "src/entry.ts"], ["src/b/b2.ts", "src/entry.ts"], ["src/b/b3.ts", "src/entry.ts"]]);
  const a = assign(defaultGrouping(f), f);
  assert.deepEqual(a.errors, []);
  assert.equal(a.leafOf.get("src/entry.ts"), a.leafOf.get("src/a/a1.ts"));
});

test("groupingScore reports the biggest leaf and one-file leaves", () => {
  const s = groupingScore(new Map([["a", "x"], ["b", "x"], ["c", "x"], ["d", "y"]]));
  assert.deepEqual(s, { groups: 2, largestShare: 0.75, largest: "x", singleFileGroups: 1 });
});

test("prefixOf keeps acronyms whole and groups dotted parts of a file", () => {
  assert.equal(prefixOf("TTDDialogTab.tsx"), "ttd");
  assert.equal(prefixOf("TTDContext.tsx"), "ttd");
  assert.equal(prefixOf("App.clipboard.ts"), "app");
  assert.equal(prefixOf("warRoomErrors.ts"), "warRoom");
});

/** A 3000-file monorepo: 40 packages, deep folders, long names. */
function bigRepo(): Facts {
  const packages: Facts["packages"] = Array.from({ length: 40 }, (_, p) => ({
    id: `pkg${p}`, name: `@big/pkg${p}`, dir: `packages/group${p % 4}/pkg${p}`, kind: "library" as const,
    deps: Array.from({ length: 30 }, (_, d) => `some-dependency-${d}`),
  }));
  const files: string[] = [];
  const imports: [string, string][] = [];
  for (let p = 0; p < 40; p++) for (let i = 0; i < 75; i++) {
    const path = `packages/group${p % 4}/pkg${p}/src/feature${i % 6}/sub${i % 3}/${["use", "get", ""][i % 3]}SomethingVeryDescriptive${i}Handler.ts`;
    files.push(path);
    if (i) imports.push([path, files[files.length - 2]]);
  }
  return facts(files, imports, packages);
}

test("digest of a 3000-file repo goes folder-first and stays within budget", () => {
  const f = bigRepo();
  assert.equal(f.files.length, 3000);
  const d = summarize(f);
  assert.ok(estimateTokens(d) <= DIGEST_TOKEN_BUDGET, `digest is ${estimateTokens(d)} tokens`);
  assert.ok(d.includes(LARGE_REPO_MARKER));
  assert.match(d, /## Default grouping/);
  assert.match(d, /Score: \d+ groups, largest .* holds \d+% of files, \d+ single-file groups\./);
});

test("digest of a small repo is not compressed", () => {
  const f = facts(["src/a.ts", "src/b.ts", "src/c.ts"], [["src/a.ts", "src/b.ts"]]);
  const d = summarize(f);
  assert.doesNotMatch(d, /Compressed/);
  assert.match(d, /src\/ \(3\): a, b, c/);
});

test("gallery stats show digest size and default-grouping score", () => {
  const m = measure(facts(["src/a.ts", "src/b.ts"], []));
  assert.ok(m.digestTokens > 0);
  assert.equal(m.defaultScore.groups, 1);
  const r: Result = {
    name: "lib", shape: "", source: "https://github.com/o/lib", sha: "a".repeat(40), local: false, status: "ok", grouping: "default", warnings: [],
    digestTokens: 13_500, defaultScore: { groups: 7, largestShare: 0.41, largest: "lib-other", singleFileGroups: 2 },
  };
  const html = renderIndex([r], { repoladderSha: "c".repeat(40), totalMs: 1 });
  assert.ok(html.includes(`<td class="n warn">13.5K</td>`)); // over budget
  assert.ok(html.includes(`title="lib-other">41%</td>`));
});
