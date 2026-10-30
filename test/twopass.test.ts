// Two-pass grouping for large repos (#257): a folder-first top digest, then one digest per part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign } from "../src/model/grouping.ts";
import type { Facts, GroupNode, Grouping } from "../src/model/schema.ts";
import {
  DIGEST_TOKEN_BUDGET, LARGE_REPO_MARKER, MAX_PART_DIGESTS, PartError, estimateTokens, partDefaultGrouping, prefixIds, summarize, summarizePart,
} from "../src/model/summary.ts";

const facts = (files: string[], imports: [string, string][], packages?: Facts["packages"]): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: packages ?? [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: packages ? packages.find((p) => path.startsWith(`${p.dir}/`))!.id : "app", loc: 10 })),
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" as const })),
  externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
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

/** One package, one flat folder of n files with distinct basenames. */
const flatRepo = (n: number) => facts(Array.from({ length: n }, (_, i) => `src/flatModule${i}.ts`), []);

/** Placeholders: one leaf per package, under two level-1 groups. */
function placeholders(): Grouping {
  const leaf = (p: number): GroupNode => ({ id: `pkg${p}`, name: `Package ${p}`, summary: "", files: [`packages/group${p % 4}/pkg${p}/**`] });
  return {
    version: 1, summary: "Big repo.",
    children: [
      { id: "front", name: "Front", summary: "", children: Array.from({ length: 20 }, (_, p) => leaf(p)) },
      { id: "back", name: "Back", summary: "", children: Array.from({ length: 20 }, (_, p) => leaf(p + 20)) },
    ],
  };
}

const leafIds = (ns: GroupNode[]): string[] => ns.flatMap((n) => (n.files ? [n.id] : leafIds(n.children!)));

test("detection: small repos stay one-pass; a folder over the 80-name cap goes two-pass", () => {
  assert.doesNotMatch(summarize(facts(["src/a.ts", "src/b.ts", "src/c.ts"], [])), /Large repo/);
  assert.doesNotMatch(summarize(flatRepo(80)), /Large repo/);
  for (const name of readdirSync(fileURLToPath(new URL("fixtures", import.meta.url)))) {
    const f = analyze(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)));
    if (f.files.length) assert.doesNotMatch(summarize(f), /Large repo/, name);
  }
  const d = summarize(flatRepo(100));
  assert.ok(d.includes(LARGE_REPO_MARKER));
  assert.match(d, /^src\/ \(100\)$/m);
});

test("top digest of a 3000-file repo is folder-first, names no file and fits the budget", () => {
  const d = summarize(bigRepo());
  assert.ok(d.includes(LARGE_REPO_MARKER), "marker");
  // the marker opens the line right after the file count
  assert.match(d, /^# t\n3000 source files [^\n]*\nLarge repo: two passes\./);
  assert.ok(d.includes("summary REPO --part"));
  assert.ok(d.includes(`at most ${MAX_PART_DIGESTS} per run`));
  assert.match(d, /## Files by folder \(file counts only/);
  // the file list names no file (entry points and runtime chains still do: tours need exact paths)
  const list = d.slice(d.indexOf("## Files by folder"), d.indexOf("## Strongest connections"));
  assert.ok(!list.includes("SomethingVeryDescriptive"), "no file names");
  assert.match(list, /^packages\/[^ ]+ \(\d+\)$/m);
  assert.doesNotMatch(d, /Compressed to fit/);
  assert.ok(estimateTokens(d) <= DIGEST_TOKEN_BUDGET, `${estimateTokens(d)} tokens`);
});

test("a part digest lists every file of the leaf, within budget, with prefixed default ids", () => {
  const f = bigRepo(), g = placeholders();
  const d = summarizePart(f, g, "pkg3");
  assert.ok(estimateTokens(d) <= DIGEST_TOKEN_BUDGET, `${estimateTokens(d)} tokens`);
  assert.match(d, /^# t — part pkg3 "Package 3"$/m);
  assert.match(d, /75 of 3000 source files are in this part\./);
  for (let i = 0; i < 75; i++) {
    const base = `${["use", "get", ""][i % 3]}SomethingVeryDescriptive${i}Handler`;
    assert.match(d, new RegExp(`[ ,:]${base}(,|$)`, "m"), base);
  }
  const list = d.slice(d.indexOf("## Files by folder"), d.indexOf("## Where this part"));
  assert.doesNotMatch(list, /Handler\.ts/, "the common extension is dropped");
  const tree = d.slice(d.indexOf("## Default grouping"));
  const ids = [...tree.matchAll(/^\s*- ([a-z0-9-]+) "/gm)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(id.startsWith("pkg3-"), id);

  // splicing the part's default grouping in as pkg3's children gives no duplicate ids
  const part = partDefaultGrouping(f, g, "pkg3");
  for (const id of leafIds(part.children)) assert.ok(id.startsWith("pkg3-"), id);
  const spliced: Grouping = structuredClone(g);
  const pkg3 = spliced.children[0].children!.find((n) => n.id === "pkg3")!;
  delete pkg3.files;
  pkg3.children = part.children;
  const a = assign(spliced, f);
  assert.deepEqual(a.errors.filter((e) => e.includes("duplicate")), []);
  assert.equal(a.leafOf.size, f.files.length);
});

test("prefixed default ids never collide with ids that already had the prefix", () => {
  // on documenso, part "trpc" got default ids "trpc-api" (trpc's api-token router) and "api" (the api package)
  const leaf = (id: string): GroupNode => ({ id, name: id, summary: "", files: [`${id}/**`] });
  const out = prefixIds([
    { ...leaf("trpc-api") },
    { id: "api", name: "Api", summary: "", children: [leaf("api-v1"), leaf("x")], split: [
      { id: "api-b1", name: "B1", summary: "", members: ["api-v1"] }, { id: "api-b2", name: "B2", summary: "", members: ["x"] },
    ] },
  ], "trpc");
  assert.deepEqual(out.map((n) => n.id), ["trpc-api", "trpc-api-2"]);
  assert.deepEqual(out[1].children!.map((n) => n.id), ["trpc-api-v1", "trpc-x"]);
  assert.deepEqual(out[1].split!.map((p) => [p.id, p.members]), [["trpc-api-b1", ["trpc-api-v1"]], ["trpc-api-b2", ["trpc-x"]]]);
});

test("a part digest counts imports and calls to other parts", () => {
  const f = bigRepo(), g = placeholders();
  const from = f.files.find((x) => x.pkg === "pkg3")!.path, to = f.files.find((x) => x.pkg === "pkg5")!.path;
  const into = f.files.find((x) => x.pkg === "pkg25")!.path;
  f.imports.push({ from, to, line: 1, kind: "static" }, { from: into, to: from, line: 1, kind: "static" });
  f.calls.push({ from, to, line: 2, endpoint: "x", kind: "http" });
  const d = summarizePart(f, g, "pkg3");
  assert.match(d, /## Where this part's code reaches/);
  // pkg5 shares pkg3's level-1 group, so it is named by leaf; pkg25 is under "back"
  assert.match(d, /^pkg5 "Package 5": out 1 imports, 1 calls$/m);
  assert.match(d, /^back "Back": in 1 imports$/m);
  assert.ok(d.indexOf("pkg5 \"Package 5\"") < d.indexOf("back \"Back\""), "heaviest first");

  const alone = summarizePart(bigRepo(), g, "pkg0");
  assert.match(alone, /\(none: this part's code keeps to itself\)/);
});

test("a part too big to list every name goes folder-first and asks for sub-placeholders", () => {
  const files: string[] = [];
  for (let d = 0; d < 30; d++) for (let i = 0; i < 50; i++) files.push(`lib/area${d}/deep/folder/aRatherLongDescriptiveModuleName${d}x${i}Service.ts`);
  const f = facts(files, []);
  const g: Grouping = { version: 1, summary: "", children: [{ id: "lib", name: "Lib", summary: "", files: ["lib/**"] }] };
  const d = summarizePart(f, g, "lib");
  assert.match(d, /^# t — part lib "Lib"\nPart still too big to list every file: split leaf lib/);
  assert.ok(estimateTokens(d) <= DIGEST_TOKEN_BUDGET, `${estimateTokens(d)} tokens`);
  const list = d.slice(d.indexOf("## Files by folder"), d.indexOf("## Where this part"));
  assert.ok(!list.includes("aRatherLongDescriptiveModuleName"));
  assert.match(list, /^lib\/area0\/deep\/folder\/ \(50\)$/m);
});

test("unknown, group and empty parts throw PartError", () => {
  const f = bigRepo(), g = placeholders();
  const code = (id: string, grouping = g) => {
    try { summarizePart(f, grouping, id); } catch (e) { assert.ok(e instanceof PartError); return [e.code, e.message] as const; }
    assert.fail(`no error for ${id}`);
  };
  const [c1, m1] = code("nope");
  assert.equal(c1, "UNKNOWN_PART");
  assert.match(m1, /^UNKNOWN_PART nope: not a leaf of grouping\.json\. Leaves: pkg\d+ \(75 files\)/);
  const [c2, m2] = code("front");
  assert.equal(c2, "UNKNOWN_PART");
  assert.match(m2, /Leaves: /);
  const empty: Grouping = structuredClone(g);
  empty.children[1].children!.push({ id: "ghost", name: "Ghost", summary: "", files: ["nowhere/**"] });
  assert.equal(code("ghost", empty)[0], "EMPTY_PART");
});

test("cli: summary --part prints a part digest, and fails cleanly", () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const fixture = fileURLToPath(new URL("fixtures/mono", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "cw-twopass-"));
  const env = { ...process.env, REPOLADDER_CONFIG_DIR: mkdtempSync(join(tmpdir(), "cw-usage-")) };
  const run = (...a: string[]) => spawnSync(process.execPath, [cli, "summary", fixture, "--out", tmp, ...a], { env, encoding: "utf8" });
  assert.equal(run().status, 0);
  copyFileSync(join(tmp, "grouping.default.json"), join(tmp, "grouping.json"));
  const g: Grouping = JSON.parse(readFileSync(join(tmp, "grouping.json"), "utf8"));
  const leaf = leafIds(g.children)[0];
  const ok = run("--part", leaf);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`— part ${leaf} "`));
  const bad = run("--part", "nope");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /UNKNOWN_PART nope/);
  const novalue = run("--part");
  assert.equal(novalue.status, 1);
  assert.match(novalue.stderr, /--part needs a leaf id/);
  rmSync(join(tmp, "grouping.json"));
  const none = run("--part", leaf);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^NO_GROUPING/);
  const usage = spawnSync(process.execPath, [cli, "nope"], { env, encoding: "utf8" });
  assert.match(usage.stderr, /\[--part leafId\]/);
});
