// #311: buildFileBoards and assign index their work (facts by leaf, patterns by folder) instead of scanning
// everything per leaf and per file. The output must be the same as the scans give.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { compileGlob, literalDir } from "../src/model/glob.ts";
import { buildFileBoards } from "../src/model/fileboards.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Facts, type GroupNode } from "../src/model/schema.ts";
import { buildFileBoards as oldBuildFileBoards } from "./helpers/oldfileboards.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** The pre-#311 file loop of assign: every pattern against every file. */
function oldAssign(grouping: Grouping, facts: Facts) {
  const leaves: { id: string; m: ReturnType<typeof compileGlob> }[] = [];
  const walk = (n: GroupNode) => {
    if (n.files) for (const f of n.files) leaves.push({ id: n.id, m: compileGlob(f) });
    n.children?.forEach(walk);
  };
  grouping.children.forEach(walk);
  const leafOf = new Map<string, string>(), unassigned: string[] = [], ambiguous: string[] = [];
  for (const { path } of facts.files) {
    let best: typeof leaves = [];
    for (const l of leaves) {
      if (!l.m.re.test(path)) continue;
      if (!best.length || l.m.specificity > best[0].m.specificity) best = [l];
      else if (l.m.specificity === best[0].m.specificity) best.push(l);
    }
    const owners = new Set(best.map((b) => b.id));
    if (!owners.size) unassigned.push(path);
    else if (owners.size > 1) ambiguous.push(`${path} (${[...owners].join(", ")})`);
    else leafOf.set(path, best[0].id);
  }
  return { leafOf, unassigned, ambiguous };
}

function same(facts: Facts, grouping: Grouping, label: string) {
  const a = assign(grouping, facts), old = oldAssign(grouping, facts);
  assert.deepEqual([...a.leafOf], [...old.leafOf], `${label}: leafOf`);
  const msg = (re: RegExp) => a.errors.find((e) => re.test(e));
  assert.equal(!!msg(/not covered by any group/), old.unassigned.length > 0, `${label}: unassigned`);
  const amb = msg(/matched equally by more than one group/);
  assert.equal(!!amb, old.ambiguous.length > 0, `${label}: ambiguous`);
  for (const x of old.ambiguous) assert.ok(amb!.includes(x), `${label}: ${x}`);
  if (a.errors.length) return;
  const model = buildModel(facts, grouping, a.leafOf);
  const mine = buildFileBoards(facts, model.nodes, a.leafOf), ref = oldBuildFileBoards(facts, model.nodes, a.leafOf);
  assert.deepEqual(mine, ref, `${label}: file boards`);
  assert.deepEqual(Object.keys(mine.boards), Object.keys(ref.boards), `${label}: board order`);
}

for (const dir of readdirSync(fixtures)) {
  test(`model perf: ${dir} gives the same file boards and assignment as the scans`, () => {
    const facts = analyze(fixtures + dir);
    same(facts, defaultGrouping(facts), `${dir} default`);
    const own = fixtures + dir + "/grouping.json";
    if (existsSync(own)) same(facts, Grouping.parse(JSON.parse(readFileSync(own, "utf8"))), `${dir} own`);
  });
}

const synth = (files: string[]): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const leaf = (id: string, ...files: string[]): GroupNode => ({ id, name: id, summary: "", files });

test("model perf: assign reports the same ambiguous, unassigned and wildcard-first cases", () => {
  const f = synth(["a/x.ts", "a/b/y.ts", "c/z.ts", "top.ts", "d/e/f.ts"]);
  // two equally specific patterns on one file, a file nothing claims, root-level and leading-** patterns
  const g: Grouping = { version: 1, summary: "t", children: [leaf("one", "a/*.ts"), leaf("two", "a/?.ts"), leaf("three", "**/y.ts"), leaf("four", "top.ts"), leaf("five", "d/e")] };
  same(f, g, "synthetic");
  const a = assign(g, f);
  assert.ok(a.errors.some((e) => /matched equally/.test(e)) && a.errors.some((e) => /not covered/.test(e)));
});

test("literalDir: the folder every match sits under", () => {
  assert.equal(literalDir("src/feat/**"), "src/feat");
  assert.equal(literalDir("src/feat/billing*"), "src/feat");
  assert.equal(literalDir("./src/feat/"), "src");
  assert.equal(literalDir("**/y.ts"), "");
  assert.equal(literalDir("top.ts"), "");
  assert.equal(literalDir("a/b/c.ts"), "a/b");
  assert.equal(literalDir("a/b?/c"), "a");
});
