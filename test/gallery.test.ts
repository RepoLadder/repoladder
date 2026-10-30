import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { buildArgs, checkSummary, coverageBad, coverageResult, edgeCounts, galleryTitle, gate, measure, parseEntries, parseThresholds, renderIndex, suggestLimits, type CheckRow, type Limits, type Result } from "../scripts/gallery.ts";
import type { GroupingScore } from "../src/model/grouping.ts";
import { EXTRAS, FONTS, THEMES } from "@repoladder/brand";
import { Grouping } from "../src/model/schema.ts";

const galleryDir = fileURLToPath(new URL("../gallery/", import.meta.url));

test("checked-in gallery repos are pinned and uniquely named", () => {
  const entries = parseEntries(JSON.parse(readFileSync(galleryDir + "repos.json", "utf8")), "repos.json");
  assert.ok(entries.length >= 5);
  assert.equal(new Set(entries.map((e) => e.name)).size, entries.length);
  for (const e of entries) assert.match(e.sha!, /^[0-9a-f]{40}$/);
});

test("large gallery repos are pinned, uniquely named and apart from repos.json", () => {
  const large = parseEntries(JSON.parse(readFileSync(galleryDir + "large.json", "utf8")), "large.json");
  const repos = parseEntries(JSON.parse(readFileSync(galleryDir + "repos.json", "utf8")), "repos.json");
  assert.ok(large.length >= 1);
  assert.equal(new Set(large.map((e) => e.name)).size, large.length);
  for (const e of large) {
    assert.match(e.sha!, /^[0-9a-f]{40}$/);
    assert.ok(!repos.some((r) => r.name === e.name), `${e.name} is also in repos.json`);
  }
});

test("checked-in gallery groupings are valid groupings", () => {
  const files = readdirSync(galleryDir + "groupings").filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1);
  for (const f of files) Grouping.parse(JSON.parse(readFileSync(galleryDir + "groupings/" + f, "utf8")));
});

test("gallery entries are validated", () => {
  assert.throws(() => parseEntries({}, "x"), /array/);
  assert.throws(() => parseEntries([{ name: "a", url: "https://github.com/a/b", sha: "main" }], "x"), /40-character/);
  assert.throws(() => parseEntries([{ name: "a b", path: "/tmp" }], "x"), /identifier/);
  assert.throws(() => parseEntries([{ name: "a" }], "x"), /url.*path/);
  assert.equal(parseEntries([{ name: "local", path: "/tmp/x" }], "x")[0].path, "/tmp/x");
});

test("edge counts sum every board", () => {
  const model = { boards: { "": { edges: [{ major: true }, { major: false }] }, a: { edges: [{ major: true }] } } };
  assert.deepEqual(edgeCounts(model), { edges: 3, majorEdges: 2 });
});

test("index page covers every repo, escapes text, and shows failures", () => {
  const ok: Result = {
    name: "lib", shape: "A <small> library", source: "https://github.com/o/lib", sha: "a".repeat(40), local: false, status: "ok",
    grouping: "default", files: 10, packages: 1, edges: 4, majorEdges: 3, boards: 2, kb: 20.5, analyzeMs: 500, buildMs: 900,
    warnings: ["pattern x matched no files"], sameAsLastRun: true,
  };
  const bad: Result = { name: "app", shape: "", source: "https://github.com/o/app", sha: "b".repeat(40), local: false, status: "failed", grouping: "default", warnings: [], error: "build exited 1: boom" };
  const html = renderIndex([ok, bad], { repoladderSha: "c".repeat(40), totalMs: 1000 });
  assert.ok(html.includes(`src="out/lib/diagram.html"`));
  assert.ok(!html.includes(`out/app/diagram.html`));
  assert.ok(html.includes("build exited 1: boom"));
  assert.ok(html.includes("A &lt;small&gt; library"));
  assert.ok(html.includes("pattern x matched no files"));
  assert.ok(html.includes("1/2 built"));
});

const score = (o: Partial<GroupingScore> = {}): GroupingScore => ({ groups: 10, largestShare: 0.18, largest: "core", singleFileGroups: 3, ...o });
const thresholds = (row: Limits, fallback: Limits = {}) => ({ fallback, repos: { lib: row } });
const ROW: Limits = { maxLargestShare: 0.23, maxSingleFileGroups: 4, minGroups: 8 };

test("checked-in thresholds parse, match repos.json and cover every pinned repo", () => {
  const t = parseThresholds(JSON.parse(readFileSync(galleryDir + "thresholds.json", "utf8")), "thresholds.json");
  const names = parseEntries(JSON.parse(readFileSync(galleryDir + "repos.json", "utf8")), "repos.json").map((e) => e.name);
  for (const k of Object.keys(t.repos)) assert.ok(names.includes(k), `thresholds.json row "${k}" is not in repos.json`);
  for (const n of names) assert.ok(t.repos[n], `repos.json entry "${n}" has no row in thresholds.json`);
});

test("thresholds are validated", () => {
  assert.throws(() => parseThresholds([], "x"), /object/);
  assert.throws(() => parseThresholds({ repos: {} }, "x"), /fallback/);
  assert.throws(() => parseThresholds({ fallback: {} }, "x"), /repos/);
  assert.throws(() => parseThresholds({ fallback: { maxGroups: 3 }, repos: {} }, "x"), /unknown limit "maxGroups"/);
  assert.throws(() => parseThresholds({ fallback: {}, repos: { a: { maxLargestShare: 1.5 } } }, "x"), /0 to 1/);
  assert.throws(() => parseThresholds({ fallback: {}, repos: { a: { minGroups: 2.5 } } }, "x"), /non-negative integer/);
  assert.throws(() => parseThresholds({ fallback: {}, repos: { "a b": {} } }, "x"), /identifier/);
  assert.deepEqual(parseThresholds({ fallback: {}, repos: { a: ROW } }, "x").repos.a, ROW);
});

test("gate: a score inside its row passes, each broken limit gives one reason, equal passes", () => {
  const t = thresholds(ROW);
  assert.deepEqual(gate("lib", score(), t), []);
  assert.deepEqual(gate("lib", score({ largestShare: 0.23 }), t), []);
  assert.deepEqual(gate("lib", score({ singleFileGroups: 4 }), t), []);
  assert.deepEqual(gate("lib", score({ groups: 8 }), t), []);
  const big = gate("lib", score({ largestShare: 0.412 }), t);
  assert.equal(big.length, 1);
  assert.match(big[0], /largest group 41\.2% \(core\) > max 23%/);
  const one = gate("lib", score({ singleFileGroups: 5 }), t);
  assert.equal(one.length, 1);
  assert.match(one[0], /5 one-file groups > max 4/);
  const few = gate("lib", score({ groups: 7 }), t);
  assert.equal(few.length, 1);
  assert.match(few[0], /7 groups < min 8/);
});

test("gate: unknown repos use the fallback and a missing limit is not checked", () => {
  const t = thresholds({ minGroups: 8 }, { maxLargestShare: 0.1 });
  assert.equal(gate("other", score(), t).length, 1);
  assert.deepEqual(gate("lib", score({ largestShare: 0.99, singleFileGroups: 99 }), t), []);
});

test("suggestLimits sets the margin: +5 points, +max(2, 25%) one-file groups, 80% of the groups", () => {
  assert.deepEqual(suggestLimits(score({ groups: 10, largestShare: 0.18, singleFileGroups: 4 })), { maxLargestShare: 0.23, maxSingleFileGroups: 6, minGroups: 8 });
  assert.equal(suggestLimits(score({ largestShare: 0.97 })).maxLargestShare, 1);
  assert.equal(suggestLimits(score({ groups: 1 })).minGroups, 1);
  assert.equal(suggestLimits(score({ singleFileGroups: 20 })).maxSingleFileGroups, 25);
});

test("checkSummary is a table with headroom, failures, errors and local rows", () => {
  const rows: CheckRow[] = [
    { name: "okrepo", local: false, score: score(), limits: ROW, reasons: [] },
    { name: "badrepo", local: false, score: score({ groups: 5 }), limits: ROW, reasons: ["5 groups < min 8"] },
    { name: "errrepo", local: false, reasons: [], error: "git fetch failed" },
    { name: "localrepo", local: true, score: score(), reasons: [] },
  ];
  const md = checkSummary(rows);
  for (const want of ["### Default-grouping gate", "| Repo |", "okrepo", "badrepo", "errrepo", "localrepo", "FAIL: 5 groups < min 8", "error: git fetch failed", "not gated (local)", "10 (min 8, +2)", "18.0% (max 23%, 5.0 pts)", "3 (max 4, 1 left)"])
    assert.ok(md.includes(want), `summary lacks "${want}"`);
});

// Offline gate: default groupings of the checked-in fixtures, with limits from suggestLimits at the time of #361.
const FIXTURE_LIMITS: Record<string, Limits> = {
  "next-app": { maxLargestShare: 0.36, maxSingleFileGroups: 2, minGroups: 4 },
  servers: { maxLargestShare: 0.3, maxSingleFileGroups: 2, minGroups: 5 },
  "remix-app": { maxLargestShare: 0.35, maxSingleFileGroups: 2, minGroups: 4 },
  routes: { maxLargestShare: 0.61, maxSingleFileGroups: 2, minGroups: 1 },
  tourapp: { maxLargestShare: 0.65, maxSingleFileGroups: 2, minGroups: 1 },
  mono: { maxLargestShare: 0.48, maxSingleFileGroups: 6, minGroups: 4 },
  checkin: { maxLargestShare: 0.72, maxSingleFileGroups: 2, minGroups: 1 },
};

for (const [name, limits] of Object.entries(FIXTURE_LIMITS)) {
  test(`fixture gate: ${name}'s default grouping stays within its limits`, () => {
    const s = measure(analyze(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)))).defaultScore;
    assert.deepEqual(gate(name, s, { fallback: {}, repos: { [name]: limits } }), []);
  });
}


test("galleryTitle: only with exactly one --only map, and it needs a name", () => {
  assert.equal(galleryTitle(["--only", "repoladder"], ["repoladder"]), undefined);
  assert.equal(galleryTitle(["--only", "repoladder", "--title", "RepoLadder"], ["repoladder"]), "RepoLadder");
  assert.throws(() => galleryTitle(["--only", "repoladder", "--title"], ["repoladder"]), /needs a name/);
  assert.throws(() => galleryTitle(["--title", "--only"], ["x"]), /needs a name/);
  assert.throws(() => galleryTitle(["--title", "X", "--only", "a,b"], ["a", "b"]), /one map/);
  assert.throws(() => galleryTitle(["--title", "X"], undefined), /one map/);
});

test("buildArgs: --title and --no-lane are appended only when asked", () => {
  const o = { cli: "cli.ts", repoDir: "r", outDir: "o", groupingFile: null };
  assert.deepEqual(buildArgs(o), ["cli.ts", "build", "r", "--out", "o", "--default"]);
  assert.deepEqual(buildArgs({ ...o, groupingFile: "g.json", lane: false, title: "RepoLadder" }), ["cli.ts", "build", "r", "--out", "o", "--grouping", "g.json", "--no-lane", "--title", "RepoLadder"]);
});

test("the index has a Tours column: total, flagged under 2, titles on hover", () => {
  const base = { shape: "x", source: "x", sha: null, local: false, status: "ok", grouping: "default", warnings: [] } as unknown as Result;
  const html = renderIndex([
    { ...base, name: "aaa", tours: { grouping: 0, derived: ["From A to B"] } },
    { ...base, name: "bbb", tours: { grouping: 2, derived: ["From C to D"] } },
    { ...base, name: "ccc" },
  ], { repoladderSha: "c".repeat(40), totalMs: 1000 });
  assert.match(html, />Tours<\/th>/);
  assert.match(html, /<td class="n warn" title="From A to B">1<\/td>/);
  assert.match(html, /<td class="n" title="2 from the grouping\nFrom C to D">3<\/td>/);
  const row = (n: string) => html.split("<tr>").find((r) => r.includes(`href="#${n}"`))!;
  assert.match(row("ccc"), /<td class="n">–<\/td>/);
});

const OLD = ["#101513", "#F3F5F2", "#62C2A5", "#161D1A", "#2A3430", "#D7DDD8", "#1F6F5C", "#18201D", "#5B6660", "#E3E9E5", "#98A49E"];
const KEYS = ["ground", "surface", "ink", "muted", "line", "accent"] as const;
function assertBrand(html: string) {
  for (const k of KEYS) for (const t of ["light", "dark"] as const) assert.ok(html.includes(THEMES[t][k]), `${t} ${k}`);
  for (const old of OLD) assert.ok(!html.toLowerCase().includes(old.toLowerCase()), `old ${old}`);
}

test("the gallery index carries the brand palette and fonts, not the old greens", () => {
  const ok: Result = {
    name: "lib", shape: "s", source: "https://github.com/o/lib", sha: "a".repeat(40), local: false, status: "ok",
    grouping: "default", files: 10, packages: 1, edges: 4, majorEdges: 3, boards: 2, kb: 20.5, analyzeMs: 500, buildMs: 900, warnings: [],
  };
  const html = renderIndex([ok], { repoladderSha: "c".repeat(40), totalMs: 1000 });
  assertBrand(html);
  assert.ok(html.includes(EXTRAS.dark.danger) && html.includes(FONTS.ui) && html.includes(FONTS.mono));
  assert.ok(html.includes("var(--font-ui)"));
});

test("gallery index shows connections undrawn per map, flagged and listed when any is", () => {
  const base: Result = { name: "app", shape: "", source: "local", sha: null, local: true, status: "ok", grouping: "default", warnings: [] };
  const good = renderIndex([{ ...base, coverage: { total: 1595, undrawn: 0, tourSteps: 0, sample: [] } }], { repoladderSha: "c".repeat(40), totalMs: 1 });
  assert.ok(good.includes("<th class=\"n\" title=\"connections with no arrow"));
  assert.ok(good.includes("0<span class=\"muted\"> / 1,595</span>"));
  assert.ok(good.includes("connections 1,595 connections, 0 undrawn"));
  assert.ok(!good.includes("<td class=\"n bad\" title=\"no arrow at the Default dial"));
  const cov = coverageResult({ total: 12, drawn: 10, noBoard: 0, usesChecked: true, tourSteps: [{ tour: "t", step: 1, board: "root", edge: ["a", "b"] }], undrawn: [{ from: "a.ts", to: "b.ts", kind: "file", reason: "minor" }, { from: "a.ts", to: "svc-x", kind: "service", reason: "minor" }] });
  assert.deepEqual(cov, { total: 12, undrawn: 2, tourSteps: 1, sample: ["a.ts -> b.ts", "a.ts -> svc-x", "tour t/1 -> root"] });
  assert.equal(coverageBad({ coverage: cov }), true);
  assert.equal(coverageBad({ coverage: { ...cov, undrawn: 0, tourSteps: 0 } }), false);
  assert.equal(coverageBad({}), false);
  const bad = renderIndex([{ ...base, coverage: cov }], { repoladderSha: "c".repeat(40), totalMs: 1 });
  assert.ok(bad.includes("<td class=\"n bad\" title=\"no arrow at the Default dial:\na.ts -&gt; b.ts"));
  assert.ok(bad.includes("1 tour steps off their board"));
  const none = renderIndex([base], { repoladderSha: "c".repeat(40), totalMs: 1 });
  assert.ok(!none.includes("connections 0 connections"));
});

test("check summary has an Undrawn column", () => {
  const md = checkSummary([{ name: "lib", local: false, reasons: [], coverage: { total: 40, undrawn: 3 }, score: score() }, { name: "x", local: true, reasons: [] }]);
  assert.ok(md.includes("| Undrawn |"));
  assert.ok(md.includes("| 3 / 40 |"));
});
