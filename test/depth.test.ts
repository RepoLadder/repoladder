import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { guardLevels, levelWarnings } from "../src/model/depth.ts";
import type { Facts, GroupNode, Grouping } from "../src/model/schema.ts";

const facts = (files: string[], imports: [string, string][] = []): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" as const })),
  externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const leaves = (ns: GroupNode[], depth = 1): { n: GroupNode; depth: number }[] =>
  ns.flatMap((n) => (n.files ? [{ n, depth }] : leaves(n.children!, depth + 1)));
const groups = (ns: GroupNode[]): GroupNode[] => ns.flatMap((n) => (n.files ? [] : [n, ...groups(n.children!)]));

test("default grouping has no fixed depth: a big folder keeps opening until its leaves are small", () => {
  // four nested levels of three folders, five files at the bottom: 405 files
  const names = ["alpha", "beta", "gamma"];
  const files: string[] = [];
  for (const a of names) for (const b of names) for (const c of names) for (const d of names)
    for (let i = 0; i < 5; i++) files.push(`src/${a}/${b}/${c}/${d}/f${i}.ts`);
  const f = facts(files);
  const g = defaultGrouping(f);
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  const ls = leaves(g.children);
  assert.equal(Math.max(...ls.map((l) => l.depth)), 4, "the old cap stopped at 3 levels");
  const sizes = new Map<string, number>();
  for (const id of a.leafOf.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  assert.ok(Math.max(...sizes.values()) <= 12, `biggest leaf has ${Math.max(...sizes.values())} files`);
  assert.deepEqual(defaultGrouping(f), g);
});

test("default grouping splits a big flat leaf by shared filename prefix", () => {
  const files = ["billing", "kiosk", "intake"].flatMap((k) => Array.from({ length: 10 }, (_, i) => `src/lib/${k}${["Api", "Cache", "Form", "Hook", "List", "Modal", "Page", "Row", "Store", "View"][i]}.ts`));
  const f = facts([...files, "src/main.ts", "src/app.ts", "src/routes.ts"]);
  const g = defaultGrouping(f);
  assert.deepEqual(assign(g, f).errors, []);
  const names = leaves(g.children).map((l) => l.n.name).sort();
  for (const k of ["Billing", "Intake", "Kiosk"]) assert.ok(names.includes(k), `${k} in ${names.join(", ")}`);
});

test("default grouping never leaves a group with one child or a level of fewer than 3 boxes", () => {
  // src/a/x and src/a/y alone would make "a" open to two boxes
  const files = [
    ...Array.from({ length: 8 }, (_, i) => `src/a/x/x${i}.ts`),
    ...Array.from({ length: 8 }, (_, i) => `src/a/y/y${i}.ts`),
    ...Array.from({ length: 13 }, (_, i) => `src/b/only/deep/b${i}.ts`),
    ...Array.from({ length: 6 }, (_, i) => `src/c/c${i}.ts`),
  ];
  const f = facts(files);
  const g = defaultGrouping(f);
  assert.deepEqual(assign(g, f).errors, []);
  for (const n of groups(g.children)) assert.ok(n.children!.length >= 3, `${n.id} opens to ${n.children!.length} boxes`);
  assert.deepEqual(levelWarnings(g), []);
});

test("guardLevels: a single child takes its parent's place; a two-box level lifts a sub-group or becomes a leaf", () => {
  const leaf = (id: string, ...files: string[]): GroupNode => ({ id, name: id, summary: "", files });
  const g: Grouping = { version: 1, summary: "", children: [
    { id: "solo", name: "Solo", summary: "s", children: [leaf("inner", "a/**")] },
    { id: "pair", name: "Pair", summary: "", children: [leaf("p1", "p/1/**"), { id: "p2", name: "P2", summary: "", children: [leaf("q1", "q/1/**"), leaf("q2", "q/2/**"), leaf("q3", "q/3/**")] }] },
    { id: "two", name: "Two", summary: "", children: [leaf("t1", "t/1/**", "t/x.ts"), leaf("t2", "t/2/**")] },
  ] };
  const out = guardLevels(g);
  assert.deepEqual(out.children[0], { id: "solo", name: "Solo", summary: "s", files: ["a/**"] });
  assert.deepEqual(out.children[1].children!.map((c) => c.id), ["p1", "q1", "q2", "q3"]);
  assert.deepEqual(out.children[2], { id: "two", name: "Two", summary: "", files: ["t/1/**", "t/x.ts", "t/2/**"] });
  assert.deepEqual(levelWarnings(out), []);
  // a two-box level whose board also shows a part from elsewhere or a service is worth a click
  const kept = guardLevels(g, (id) => (id === "two" ? 1 : 0));
  assert.deepEqual(kept.children[2].children!.map((c) => c.id), ["t1", "t2"]);
  const w = levelWarnings(g);
  assert.equal(w.length, 3);
  assert.match(w[0], /"solo" has a single child "inner"/);
  assert.match(w[1], /"pair" opens to only 2 boxes/);
});

test("assign warns about a hand-written level that opens to too few boxes", () => {
  const f = facts(["a/x.ts", "a/y.ts", "b/z.ts"]);
  const g: Grouping = { version: 1, summary: "", children: [
    { id: "a", name: "A", summary: "", children: [{ id: "a1", name: "A1", summary: "", files: ["a/**"] }] },
    { id: "b", name: "B", summary: "", files: ["b/**"] },
  ] };
  const r = assign(g, f);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /"a" has a single child/.test(w)));
});

test("assign: a level warning names the group's parent and file count (#434)", () => {
  const facts = { version: 1, repo: "r", sha: null, packages: [], files: ["a/x.ts", "a/y.ts", "b/z.ts"].map((path) => ({ path, pkg: "p", loc: 1 })), imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [] } as any;
  const g = { version: 1, summary: "s", children: [{ id: "pair", name: "Pair", summary: "s", children: [{ id: "a", name: "A", summary: "s", files: ["a/**"] }, { id: "b", name: "B", summary: "s", files: ["b/**"] }] }] } as any;
  const w = assign(g, facts).warnings.find((x: string) => /"pair" opens to only 2 boxes/.test(x));
  assert.match(w!, /\(inside "the top level", 3 files\)$/);
});
