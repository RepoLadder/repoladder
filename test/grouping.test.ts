import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { workspaceMatcher } from "../src/analyze/packages.ts";
import { levelWarnings } from "../src/model/depth.ts";
import { assign, defaultGrouping, groupingScore, splitOversized } from "../src/model/grouping.ts";
import type { Facts, GroupNode, Grouping } from "../src/model/schema.ts";

const facts = (files: string[]): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const W = ["apple", "brick", "cloud", "delta", "ember", "frost", "grain", "haven", "ivory", "jolly"];
const n = (k: number, p: (i: number) => string) => Array.from({ length: k }, (_, i) => p(i));
const tree = (ns: GroupNode[]): unknown[] => ns.map((x) => (x.children ? [x.id, x.name, tree(x.children)] : [x.id, x.name]));
const siblings = [...n(6, (i) => `src/lib/${W[i]}.ts`), ...n(6, (i) => `src/components/${W[i]}.tsx`)];
const wsDir = fileURLToPath(new URL("./fixtures/workspace", import.meta.url));

test("a workspace member without a package.json is a package", () => {
  const f = analyze(wsDir);
  assert.deepEqual(f.packages.map((p) => [p.id, p.kind, p.dir]), [
    ["web", "web", "apps/web"],
    ["codegen", "library", "apps/web/tools/codegen"],
    ["ui", "library", "packages/ui"],
    ["utils", "library", "packages/utils"],
  ]);
  const g = defaultGrouping(f);
  assert.deepEqual(g.children.map((c) => c.id), ["web", "codegen", "shared-packages"]);
  assert.deepEqual(g.children[2].children!.map((c) => c.name), ["Utilities", "UI"]);
  assert.deepEqual(assign(g, f).errors, []);
  assert.deepEqual(defaultGrouping(analyze(wsDir)), g);
});

test("workspaceMatcher honours plain folders, one-level globs and exclusions", () => {
  const m = workspaceMatcher(["apps/web", "packages/*", "!packages/legacy"]);
  assert.deepEqual(
    ["apps/web", "apps/web/src", "packages/ui", "packages/ui/src", "packages/legacy", "apps/docs"].map(m),
    [true, false, true, false, false, false],
  );
});

test("a collapsed folder chain is named by its last two folders", () => {
  const files = [...n(8, (i) => `src/features/billing/invoices/pdf/a${i}.ts`), ...n(4, (i) => `src/features/billing/invoices/pdf/x/b${i}.ts`), ...siblings];
  const f = facts(files);
  const g = defaultGrouping(f);
  assert.deepEqual(assign(g, f).errors, []);
  assert.equal(g.children[0].id, "app-features");
  assert.equal(g.children[0].name, "Invoices PDF");
  assert.deepEqual(levelWarnings(g), []);
  assert.deepEqual(defaultGrouping(f), g);

  const f2 = facts([...n(10, (i) => `src/web/(shop)/checkout/${W[i]}.tsx`), ...siblings]);
  const g2 = defaultGrouping(f2);
  assert.deepEqual(tree(g2.children), [["app-web", "Web checkout"], ["app-components", "Components"], ["app-lib", "Library"]]);
});

const oversize = [
  ...n(10, (i) => `src/big/main/${W[i]}.ts`),
  ...n(3, (i) => `src/big/x/${W[i]}X.ts`),
  ...n(6, (i) => `src/a/${W[i]}A.ts`),
  ...n(6, (i) => `src/b/${W[i]}B.ts`),
];
const leaf = (id: string, name: string, dir: string): GroupNode => ({ id, name, summary: "", files: [`src/${dir}/**`] });

test("a leaf holding most of the repo is split", () => {
  const f = facts(oversize);
  const g = defaultGrouping(f);
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(groupingScore(a.leafOf), { groups: 5, largestShare: 0.24, largest: "app-a", singleFileGroups: 0 });
  assert.equal(g.children[0].id, "app-big");
  assert.equal(g.children[0].children!.length, 3);
  assert.deepEqual(levelWarnings(g), []);
  assert.deepEqual(defaultGrouping(f), g);
});

test("splitOversized splits a hand-written grouping, and leaves small repos alone", () => {
  const f = facts(oversize);
  const hand: Grouping = { ...defaultGrouping(f), children: [leaf("big", "Big", "big"), leaf("a", "A", "a"), leaf("b", "B", "b")] };
  const out = splitOversized(hand, f);
  assert.equal(groupingScore(assign(out, f).leafOf).largestShare, 0.24);

  const small = facts([...n(8, (i) => `src/big/${W[i]}.ts`), ...n(3, (i) => `src/a/${W[i]}A.ts`)]);
  const g: Grouping = { ...defaultGrouping(small), children: [leaf("big", "Big", "big"), leaf("a", "A", "a")] };
  assert.deepEqual(splitOversized(g, small), g);
});

test("a ** exclusion still keeps a folder out of the packages", () => {
  const m = workspaceMatcher(["packages/*", "!**/legacy"]);
  assert.equal(m("packages/legacy"), false);
  assert.equal(m("packages/ui"), true);
});
