import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, decide, parseNameStatus, runsEverything, type Entry } from "../scripts/cichanges.ts";

const e = (status: string, path: string): Entry => ({ status, path });

test("a docs-only PR skips the heavy jobs and the Windows leg", () => {
  assert.deepEqual(classify([e("M", "docs/a.md"), e("M", "CLAUDE.md"), e("A", "docs/media/x.md")]), { code: false, windows: false });
});

test("any code, root markdown, deleted or renamed file runs the heavy jobs", () => {
  assert.equal(classify([e("M", "docs/a.md"), e("A", "src/a.ts")]).code, true);
  assert.equal(classify([e("D", "docs/x.md")]).code, true);
  assert.equal(classify([e("R", "docs/x.md")]).code, true);
  assert.equal(classify([e("M", "README.md")]).code, true);
  assert.equal(classify([e("M", "gallery/demos.json")]).code, true);
  assert.equal(classify([e("M", "test/privacy.test.ts")]).code, true);
  assert.equal(classify([e("M", "server/ping/worker.ts")]).code, true);
});

test("the Windows leg runs for install and packaging paths only", () => {
  for (const p of ["src/install.ts", "package-lock.json", "plugin/skills/map/SKILL.md", ".github/workflows/ci.yml", "scripts/cichanges.ts", "tsconfig.json"]) {
    assert.equal(classify([e("M", p)]).windows, true, p);
  }
  assert.equal(classify([e("M", "src/analyze/fields.ts")]).windows, false);
  assert.equal(classify([e("D", "plugin/x.md")]).windows, true);
});

test("an empty list runs everything", () => {
  assert.deepEqual(classify([]), { code: true, windows: true });
});

test("parseNameStatus reads status and path, and rejects garbage", () => {
  assert.deepEqual(parseNameStatus("M\tdocs/a.md\nA\tsrc/b.ts\n"), [e("M", "docs/a.md"), e("A", "src/b.ts")]);
  assert.equal(parseNameStatus("what is this"), null);
  assert.deepEqual(parseNameStatus(""), []);
});

test("decide fails safe: non-PR events, missing shas, git errors and unparsable output run everything", () => {
  const docs = () => "M\tdocs/a.md\n";
  const pr = { EVENT: "pull_request", BASE_SHA: "a", HEAD_SHA: "b" };
  assert.deepEqual(decide(pr, docs), { code: false, windows: false, files: 1 });
  assert.equal(decide({ ...pr, EVENT: "push" }, docs).code, true);
  assert.equal(decide({ ...pr, EVENT: "workflow_dispatch" }, docs).windows, true);
  assert.equal(decide({ EVENT: "pull_request" }, docs).code, true);
  assert.equal(decide(pr, () => { throw new Error("git"); }).code, true);
  assert.equal(decide(pr, () => "garbage").code, true);
  assert.equal(decide(pr, () => "").windows, true);
});

test("a PR into main (the release PR) runs everything whatever changed; other bases are classified", () => {
  const docs = () => "M\tdocs/a.md\n";
  const pr = { EVENT: "pull_request", BASE_SHA: "a", HEAD_SHA: "b" };
  assert.equal(runsEverything("pull_request", "main"), true);
  assert.equal(runsEverything("push", undefined), true);
  assert.equal(runsEverything("pull_request", "develop"), false);
  assert.deepEqual(decide({ ...pr, BASE_REF: "main" }, docs), { code: true, windows: true, files: 0 });
  assert.deepEqual(decide({ ...pr, BASE_REF: "develop" }, docs), { code: false, windows: false, files: 1 });
});

const ci = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");
const jobs = ci.slice(ci.indexOf("\njobs:")).split(/\n  (?=[a-z-]+:\n)/).slice(1);

test("ci.yml triggers: PRs into main and develop, ready_for_review, push to main with no paths, manual dispatch", () => {
  assert.match(ci, /pull_request:\n\s+branches: \[main, develop\]\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(ci, /push:\n\s+branches: \[main\]\n/);
  assert.ok(!/paths(-ignore)?:/.test(ci));
  assert.match(ci, /workflow_dispatch:/);
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});

test("ci.yml: only `changes` and `leak-guard` carry the draft condition, every other job needs `changes`", () => {
  assert.equal(jobs.length, 9);
  for (const j of jobs) {
    const name = j.slice(0, j.indexOf(":"));
    assert.match(j, /timeout-minutes: \d+/, name);
    if (name === "changes" || name === "leak-guard") assert.match(j, /draft == false/);
    else {
      assert.match(j, /needs: (changes|\[changes\b)/, name);
      assert.ok(!/draft/.test(j), name);
    }
  }
});

test("ci.yml: only the `check` gate uses always(), nothing uses cancelled(), and every action is SHA-pinned or local", () => {
  assert.ok(!/cancelled\(\)/.test(ci));
  assert.equal(ci.match(/always\(\)/g)?.length, 1);
  const check = jobs.find((j) => j.startsWith("check:"))!;
  assert.match(check, /if: \$\{\{ always\(\) && needs\.changes\.outputs\.code == 'true' \}\}/);
  for (const m of ci.matchAll(/uses: (\S+)/g)) assert.match(m[1], /^\.\/|@[0-9a-f]{40}$/, m[1]);
});

test("ci.yml: sharded unit job and aggregating gate", () => {
  const job = (n: string) => jobs.find((j) => j.startsWith(`${n}:`))!;
  const unit = job("unit");
  assert.match(unit, /matrix:\n\s+shard: \[1, 2, 3\]/);
  assert.ok(unit.includes('--test-shard=${{ matrix.shard }}/${{ strategy.job-total }} "test/*.test.ts"'));
  assert.ok(!/npm run (typecheck|build)/.test(unit));
  const tb = job("typecheck-build");
  assert.equal(tb.match(/npm run typecheck/g)?.length, 1);
  assert.equal(tb.match(/npm run build/g)?.length, 1);
  const check = job("check");
  assert.match(check, /name: test, typecheck, build\n/);
  assert.match(check, /needs: \[changes, unit, typecheck-build\]/);
  assert.ok(check.includes("needs.unit.result") && check.includes("needs.typecheck-build.result"));
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.ok(!pkg.scripts.test.includes("--test-shard"));
});
