import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, decide, decideViewer, touchesViewer, touchesWorkflows, parseNameStatus, runsEverything, type Entry } from "../scripts/cichanges.ts";

const e = (status: string, path: string): Entry => ({ status, path });

test("a docs-only PR skips the heavy jobs and the Windows leg", () => {
  assert.deepEqual(classify([e("M", "docs/a.md"), e("M", "CLAUDE.md"), e("A", "docs/media/x.md")]), { code: false, windows: false, workflows: false });
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

test("the workflows flag is true for any workflow file change, false for everything else", () => {
  for (const x of [e("M", ".github/workflows/ci.yml"), e("A", ".github/workflows/publish.yml"), e("D", ".github/workflows/old.yml")]) {
    assert.equal(classify([x]).workflows, true, x.path);
    assert.equal(touchesWorkflows([x]), true, x.path);
  }
  for (const p of ["docs/a.md", "src/a.ts", ".github/CODEOWNERS", ".github/actions/leakguard/action.yml"]) {
    assert.equal(classify([e("M", p)]).workflows, false, p);
  }
  const env = { EVENT: "pull_request", BASE_REF: "develop", BASE_SHA: "a", HEAD_SHA: "b" };
  assert.equal(decide(env, () => "M\t.github/workflows/ci.yml\n").workflows, true);
  assert.equal(decide(env, () => "M\tdocs/a.md\n").workflows, false);
  assert.equal(decide(env, () => "").workflows, true);
  assert.equal(decide(env, () => "garbage").workflows, true);
  assert.equal(decide(env, () => { throw new Error("git"); }).workflows, true);
  assert.equal(decide({ ...env, EVENT: "push" }, () => "M\tdocs/a.md\n").workflows, true);
  assert.equal(decide({ ...env, BASE_SHA: "" }, () => "M\tdocs/a.md\n").workflows, true);
  assert.equal(decide({ ...env, BASE_REF: "main" }, () => "M\tdocs/a.md\n").workflows, true);
});

test("an empty list runs everything", () => {
  assert.deepEqual(classify([]), { code: true, windows: true, workflows: true });
});

test("parseNameStatus reads status and path, and rejects garbage", () => {
  assert.deepEqual(parseNameStatus("M\tdocs/a.md\nA\tsrc/b.ts\n"), [e("M", "docs/a.md"), e("A", "src/b.ts")]);
  assert.equal(parseNameStatus("what is this"), null);
  assert.deepEqual(parseNameStatus(""), []);
});

test("decide fails safe: non-PR events, missing shas, git errors and unparsable output run everything", () => {
  const docs = () => "M\tdocs/a.md\n";
  const pr = { EVENT: "pull_request", BASE_SHA: "a", HEAD_SHA: "b" };
  assert.deepEqual(decide(pr, docs), { code: false, windows: false, workflows: false, files: 1 });
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
  assert.deepEqual(decide({ ...pr, BASE_REF: "main" }, docs), { code: true, windows: true, workflows: true, files: 0 });
  assert.deepEqual(decide({ ...pr, BASE_REF: "develop" }, docs), { code: false, windows: false, workflows: false, files: 1 });
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

test("ci.yml: only `changes`, `leak-guard` and `gate` carry the draft condition, every other job needs `changes`", () => {
  assert.equal(jobs.length, 12);
  for (const j of jobs) {
    const name = j.slice(0, j.indexOf(":"));
    assert.match(j, /timeout-minutes: \d+/, name);
    if (name === "changes" || name === "leak-guard" || name === "gate") assert.match(j, /draft == false/);
    if (name === "gate") assert.match(j, /needs: \[changes\b/);
    else if (name !== "changes" && name !== "leak-guard") {
      assert.match(j, /needs: (changes|\[changes\b)/, name);
      assert.ok(!/draft/.test(j), name);
    }
  }
});

test("ci.yml: only `check` and `gate` use always(), nothing uses cancelled(), and every action is SHA-pinned or local", () => {
  assert.ok(!/cancelled\(\)/.test(ci));
  assert.equal(ci.match(/always\(\)/g)?.length, 2);
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
  assert.match(check, /needs: \[changes, unit, typecheck-build, viewer-guard\]/);
  assert.ok(check.includes("needs.unit.result") && check.includes("needs.typecheck-build.result"));
  assert.ok(check.includes("needs.viewer-guard.result") && check.includes('"$GUARD" = skipped'));
  const guard = job("viewer-guard");
  assert.match(guard, /needs\.changes\.outputs\.viewer == 'true'/);
  assert.ok(guard.includes("npm run guardbase") && guard.includes("npm run motioncheck"));
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.ok(!pkg.scripts.test.includes("--test-shard"));
});

test("touchesViewer is true for viewer, build, baseline, fixture, lockfile and workflow files", () => {
  for (const p of ["src/viewer/main.ts", "src/build/layout.ts", "test/baselines/viewer-structure.json", "test/fixtures/tourapp/a.ts", "package-lock.json", ".github/workflows/ci.yml", "scripts/guardbase.ts"]) {
    assert.equal(touchesViewer([e("M", p)]), true, p);
  }
});

test("touchesViewer is false for docs and analyzer-only changes", () => {
  assert.equal(touchesViewer([e("M", "docs/a.md"), e("M", "src/analyze/x.ts")]), false);
});

test("decideViewer fails safe and otherwise follows the changed files", () => {
  const env = { EVENT: "pull_request", BASE_REF: "develop", BASE_SHA: "a", HEAD_SHA: "b" };
  assert.equal(decideViewer(env, () => "M\tsrc/viewer/main.ts\n"), true);
  assert.equal(decideViewer(env, () => "M\tdocs/a.md\nM\tsrc/analyze/x.ts\n"), false);
  assert.equal(decideViewer(env, () => ""), true);
  assert.equal(decideViewer(env, () => { throw new Error("git"); }), true);
  assert.equal(decideViewer(env, () => "garbage"), true);
  assert.equal(decideViewer({ ...env, EVENT: "push" }, () => "M\tdocs/a.md\n"), true);
  assert.equal(decideViewer({ ...env, BASE_REF: "main" }, () => "M\tdocs/a.md\n"), true);
});

const job = (n: string) => jobs.find((j) => j.startsWith(`${n}:`))!;
const GATE_NEEDS = ["changes", "unit", "typecheck-build", "viewer-guard", "install", "version-bump", "no-dist", "actionlint"];

test("ci.yml: changes exposes workflows, and actionlint is path-filtered, pinned and checksum-verified", () => {
  assert.match(job("changes"), /workflows: \$\{\{ steps\.f\.outputs\.workflows \}\}/);
  const al = job("actionlint");
  assert.match(al, /needs: changes\n/);
  assert.match(al, /if: needs\.changes\.outputs\.workflows == 'true'\n/);
  assert.deepEqual([...al.matchAll(/uses: (\S+)/g)].map((m) => m[1].split("@")[0]), ["actions/checkout"]);
  assert.match(al, /version=1\.7\.12\n/);
  assert.match(al, /sha256=[0-9a-f]{64}\n/);
  assert.ok(al.includes("sha256sum -c -"));
});

test("ci.yml: the ci gate job aggregates every job and fails on failure or cancelled", () => {
  const gate = job("gate");
  assert.match(gate, /name: ci gate\n/);
  assert.ok(gate.includes(`needs: [${GATE_NEEDS.join(", ")}]`));
  for (const n of GATE_NEEDS) assert.ok(gate.includes(`needs.${n}.result`), n);
  assert.match(gate, /failure\|cancelled/);
});

// Runs the gate's shell script from ci.yml with the given job results.
function gate(env: Record<string, string>) {
  const run = /run: \|\n((?: {10}.*\n|\n)+)/.exec(job("gate"))![1].replace(/^ {10}/gm, "");
  const base = { CODE: "true", CHANGES: "success", UNIT: "success", BUILD: "success", VIEWER: "success", INSTALL: "success", VERSION_BUMP: "skipped", NO_DIST: "success", ACTIONLINT: "skipped" };
  return spawnSync("bash", ["-c", run], { env: { PATH: process.env.PATH ?? "", ...base, ...env }, encoding: "utf8" }).status;
}

test("the gate script passes and fails on the intended job results", () => {
  const docs = { CODE: "false", UNIT: "skipped", BUILD: "skipped", VIEWER: "skipped", INSTALL: "skipped", NO_DIST: "skipped" };
  assert.equal(gate(docs), 0);
  assert.equal(gate({}), 0);
  assert.equal(gate({ INSTALL: "skipped" }), 1);
  assert.equal(gate({ UNIT: "skipped" }), 1);
  assert.equal(gate({ BUILD: "failure" }), 1);
  assert.equal(gate({ INSTALL: "cancelled" }), 1);
  assert.equal(gate({ VIEWER: "failure" }), 1);
  assert.equal(gate({ ACTIONLINT: "failure" }), 1);
  assert.equal(gate({ ACTIONLINT: "success" }), 0);
  assert.equal(gate({ ACTIONLINT: "skipped" }), 0);
  assert.equal(gate({ VIEWER: "skipped" }), 0);
  assert.equal(gate({ CHANGES: "failure", CODE: "" }), 1);
  assert.equal(gate({ CHANGES: "skipped", ...docs }), 1);
  assert.equal(gate({ ...docs, ACTIONLINT: "failure" }), 1);
  assert.equal(gate({ ...docs, NO_DIST: "failure" }), 1);
});
