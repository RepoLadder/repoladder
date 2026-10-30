import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILD_INPUTS } from "../scripts/verifydist.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ci = read(".github/workflows/ci.yml");
const block = (text: string, key: string) => {
  const m = new RegExp(`\\n  ${key}:\\n((?:    .*\\n|\\n)+)`).exec(text);
  assert.ok(m, `${key} block`);
  return m[1];
};

test("ci.yml runs on non-draft PRs into main and develop, and on every push to main", () => {
  const pr = block(ci, "pull_request");
  assert.match(pr, /branches: \[main, develop\]/);
  assert.match(pr, /ready_for_review/);
  const push = block(ci, "push");
  assert.match(push, /branches: \[main\]/);
  assert.ok(!/paths/.test(push));
  assert.match(ci, /\n  workflow_dispatch:/);
});


test("the no-dist job text describes develop and the release", () => {
  const job = ci.slice(ci.indexOf("\n  no-dist:"));
  assert.match(job, /develop/);
  assert.ok(!/restore it from the base branch/.test(job));
});



test("dependabot targets develop on both ecosystems", () => {
  const dep = read(".github/dependabot.yml");
  assert.equal(dep.match(/^    target-branch: develop$/gm)?.length, 2);
  assert.equal(dep.match(/package-ecosystem:/g)?.length, 2);
});


const rebuild = read(".github/workflows/rebuild-dist.yml");
const leakAction = read(".github/actions/leakguard/action.yml");

test("ci.yml has a leak-guard job that docs-only PRs still run", () => {
  const job = ci.slice(ci.indexOf("\n  leak-guard:"), ci.indexOf("\n  check:"));
  assert.ok(job.length > 0, "leak-guard job precedes check");
  assert.ok(!/\bneeds:/.test(job), "no needs: it must not depend on changes");
  assert.ok(!/changes\.outputs/.test(job.replace(/^\s*#.*$/gm, "")), "not gated by changes.outputs.code");
  assert.match(job, /name: leak guard/);
  assert.match(job, /uses: \.\/\.github\/actions\/leakguard/);
  assert.match(ci, /\npermissions:\n  contents: read\n/);
});

test("rebuild-dist.yml runs the leak guard before it pushes", () => {
  const guard = rebuild.indexOf("uses: ./.github/actions/leakguard");
  assert.ok(guard > 0);
  assert.ok(guard < rebuild.indexOf("git push origin"));
  assert.ok(guard > rebuild.indexOf("npm ci"));
});

test("the leak-guard action pins gitleaks by SHA256 and requires it", () => {
  assert.match(leakAction, /GITLEAKS_SHA256: [0-9a-f]{64}\b/);
  assert.match(leakAction, /sha256sum -c/);
  assert.match(leakAction, /leakguard\.ts --require-gitleaks/);
});

test("every uses: in the leak-guard action, job and rebuild step is a full SHA or a local path", () => {
  const uses = [leakAction, ci.slice(ci.indexOf("\n  leak-guard:"), ci.indexOf("\n  check:")), rebuild]
    .flatMap((t) => [...t.matchAll(/^\s*-?\s*uses: (\S+)/gm)].map((m) => m[1]));
  assert.ok(uses.length >= 4);
  for (const u of uses) assert.ok(u.startsWith("./") || /@[0-9a-f]{40}$/.test(u), u);
});

test("verify-dist.yml runs after the rebuild bot, daily and on demand, never on PRs", () => {
  const v = read(".github/workflows/verify-dist.yml");
  assert.match(v, /workflow_run:\n\s+workflows: \["Rebuild bundle"\]/);
  assert.match(v, /\n  schedule:/);
  assert.match(v, /\n  workflow_dispatch:/);
  assert.ok(!/pull_request/.test(v));
  assert.match(v, /fetch-depth: 0/);
  assert.match(v, /ref: main/);
  assert.match(v, /github\.event_name == 'workflow_run' && '--allow-stale'/);
  assert.equal(v.match(/--allow-stale/g)?.length, 1);
});

test("rebuild-dist.yml triggers on every bundle build input", () => {
  const r = read(".github/workflows/rebuild-dist.yml");
  for (const p of BUILD_INPUTS) {
    const want = p === "src" ? "src/**" : p;
    assert.ok(r.includes(`- "${want}"`), `rebuild-dist.yml paths lack ${want}`);
  }
  assert.match(r, /github\.actor != 'github-actions\[bot\]'/);
});

test("ci.yml keeps no-dist and does not run the verifier on push or PR", () => {
  assert.match(ci, /\n  no-dist:/);
  assert.ok(!/verifydist|verify-dist/.test(ci));
});
