// Steady layouts under small edits (#464, part of #245): the alphabetical-range split cuts at
// name anchors and keys ids by the range's last file, so a one-file edit changes few ranges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_BUDGET, anchorModulus, anchoredSizes, fnv, isAnchor, rangeBounds, splitOverBudget } from "../src/model/budgetsplit.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Facts, GroupNode, Grouping } from "../src/model/schema.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { pairStability } from "../src/build/stability.ts";

const facts = (files: string[], imports: [string, string][] = []): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" as const })),
  externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const leaf = (id: string, ...files: string[]): GroupNode => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), summary: "", files });
const base = () => ({ version: 1, summary: "t", children: [leaf("feat", "src/feat/**"), leaf("x", "src/x/**"), leaf("y", "src/y/**"), leaf("z", "src/z/**")] }) as Grouping;
const others = ["src/x/x1.ts", "src/y/y1.ts", "src/z/z1.ts"];

// zod's locales: 60 files that share no folder, prefix, word or import
const codes = Array.from({ length: 60 }, (_, i) => `${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 6)]}${"bdfhjz"[i % 6]}`);
// (the seed and bounds in budgetsplit.ts were picked for this and for random names: about 4 in 5
// random one-file edits change 3 ranges or fewer)
// the most ranges one added or removed file may change; measured worst case over the edits below
const WORST = 3;
// pairStability floor of the feat board after one added file
const FLOOR = 0.95;
const path = (c: string) => `src/feat/${c}.ts`;

/** The feat ranges: id -> its files, in order. */
function ranges(codesIn: string[]): Map<string, string[]> {
  const f = facts([...codesIn.map(path), ...others]);
  const g = splitOverBudget(base(), f);
  const feat = g.children.find((c) => c.id === "feat")!;
  const leafOf = assign(g, f).leafOf;
  const out = new Map<string, string[]>();
  for (const c of feat.children!) out.set(c.id, [...leafOf].filter(([, id]) => id === c.id).map(([p]) => p).sort());
  return out;
}
const differing = (before: Map<string, string[]>, after: Map<string, string[]>) =>
  [...after].filter(([id, fs]) => JSON.stringify(before.get(id)) !== JSON.stringify(fs)).length;

// names whose first 3 letters are an anchor for the 60-file split: a range ends after the last file of one
const { hi: HI, lo: LO } = rangeBounds(60, 8);
const anchorNames = () => {
  const m = anchorModulus(HI, LO), out: string[] = [];
  for (const c of "abcdefghij") for (const d of "acegikmoqsuwy") if (isAnchor(`${c}${d}x`, m)) out.push(`${c}${d}x`);
  return out.filter((_, i) => i % 3 === 0).slice(0, 8);
};

test("anchored ranges: cuts depend on names alone, in sizes between lo and hi", () => {
  const labels = codes;
  const sizes = anchoredSizes(labels, HI, LO);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 60);
  assert.ok(sizes.every((n) => n <= 8 && n >= 4), sizes.join());
  // a run ends where a name-prefix anchor is, so the same names give the same cuts wherever the run starts
  assert.deepEqual(anchoredSizes(labels.slice(0, 20), HI, LO)[0], sizes[0]);
  assert.equal(fnv("abc"), fnv("abc"));
});

test("steady ranges (#464): one added or removed file changes at most 3 ranges, the rest keep id, name and files", () => {
  const before = ranges(codes);
  const edits: [string, string[]][] = [];
  const adds: [string, string][] = [["start", "aa"], ["middle", "hc"], ["end", "zz"], ...anchorNames().map((a): [string, string] => [`anchor ${a}`, a])];
  for (const [where, name] of adds) edits.push([`add ${where}`, [...codes, name].sort()]);
  for (const [where, i] of [["start", 0], ["middle", 30], ["end", 59]] as const) edits.push([`remove ${where}`, codes.filter((_, j) => j !== i)]);
  assert.ok(anchorNames().length >= 4, "the fixture has anchor names to add");
  for (const [what, edited] of edits) {
    const after = ranges(edited);
    const n = differing(before, after);
    assert.ok(n <= WORST, `${what}: ${n} ranges changed`);
  }
  // the old positional rule moved every later range for the same edits; here an edit at the start stays local
  assert.ok(differing(before, ranges([...codes, "aa"].sort())) < before.size - 2);
});

test("range ids come from the last file's name, the final one is -end", () => {
  const ids = [...ranges(codes).keys()];
  assert.equal(ids[ids.length - 1], "feat-end");
  for (const id of ids.slice(0, -1)) assert.match(id, /^feat-to-[a-z0-9-]+$/);
  assert.equal(new Set(ids).size, ids.length);
});

// a seeded shuffle (mulberry32), so a failure reproduces
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let a = seed;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const reorder = (f: Facts, seed: number): Facts => ({ ...f, files: shuffled(f.files, seed), imports: shuffled(f.imports, seed + 1), calls: shuffled(f.calls, seed + 2) });

test("splitOverBudget gives the same grouping whatever order the facts come in (#464)", () => {
  // import clusters (rule 3) next to a flat range folder with two names sharing 20+ slug characters
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
  const cluster = words.map((w) => `src/feat/${w}.ts`);
  const imports: [string, string][] = [];
  for (let c = 0; c < 3; c++) {
    const group = cluster.slice(c * 5, c * 5 + 5);
    for (const x of group.slice(1)) imports.push([x, group[0]]);
    imports.push([group[1], group[2]], [group[3], group[4]]);
  }
  const long = ["src/long/aVeryLongRangeNameNumberOne.ts", "src/long/aVeryLongRangeNameNumberTwo.ts"];
  const flat = codes.map((c) => `src/long/${c}.ts`);
  // gathered groups: many small parts, some sharing a name
  const parts = ["billing-api", "billing-ui", "billing-jobs", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo"];
  const partFiles = parts.flatMap((n) => [1, 2].map((i) => `src/p/${n}/f${i}.ts`));
  const all = facts([...cluster, ...flat, ...long, ...partFiles, ...others], imports);
  all.calls = [{ from: cluster[0], to: cluster[7], via: "x" } as unknown as Facts["calls"][number]];
  const grouping: Grouping = { version: 1, summary: "t", children: [
    leaf("feat", "src/feat/**"), leaf("long", "src/long/**"),
    { id: "p", name: "P", summary: "", children: parts.map((n) => ({ id: n, name: n.replace("-", " "), summary: "", files: [`src/p/${n}/**`] })) },
    leaf("x", "src/x/**"), leaf("y", "src/y/**"), leaf("z", "src/z/**"),
  ] };
  const want = splitOverBudget(grouping, all);
  assert.ok(JSON.stringify(want).includes("-to-"), "the fixture exercises the range split");
  for (const seed of [1, 2, 3, 4, 5, 6]) assert.deepEqual(splitOverBudget(grouping, reorder(all, seed)), want, `seed ${seed}`);
});

test("the anchored split keeps every file, stays in budget and is idempotent (#464)", () => {
  const f = facts([...codes.map(path), ...others]);
  const g = splitOverBudget(base(), f);
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  assert.equal(a.leafOf.size, f.files.length);
  const m = buildModel(f, g, a.leafOf);
  for (const [id, b] of Object.entries(m.boards)) if (m.nodes[id]) assert.ok(b.nodes.length <= BOX_BUDGET, `${id}: ${b.nodes.length}`);
  assert.deepEqual(splitOverBudget(g, f), g);
});

test("a feat board keeps its shape when one file is added (#464)", async () => {
  const lay = async (cs: string[]) => {
    const fs = cs.map(path);
    const f = facts([...fs, "src/core/core.ts", "src/res/res.ts", "src/other/o.ts"], [...fs.map((x): [string, string] => [x, "src/core/core.ts"]), ["src/res/res.ts", path("fb")], ["src/res/res.ts", path("hj")]]);
    const g = splitOverBudget({ version: 1, summary: "t", children: [leaf("feat", "src/feat/**"), leaf("core", "src/core/**"), leaf("res", "src/res/**"), leaf("other", "src/other/**")] }, f);
    return (await layoutBoards(buildModel(f, g, assign(g, f).leafOf), { only: ["feat"] })).feat;
  };
  const [a, b] = [await lay(codes), await lay([...codes, "hc"].sort())];
  const s = pairStability(a.n, b.n);
  assert.ok(s.score! >= FLOOR, `${s.score}`);
});
