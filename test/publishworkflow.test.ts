// Static checks over .github/workflows/publish.yml (#420): the publish path stays gated. No YAML parser; text assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wf = readFileSync(fileURLToPath(new URL("../.github/workflows/publish.yml", import.meta.url)), "utf8");
const code = wf.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
const block = (re: RegExp) => { const m = re.exec(code); assert.ok(m, `no match for ${re}`); return m[0]; };
const publishJob = block(/^ {2}publish:[\s\S]*?(?=^ {2}release:)/m);
const releaseJob = block(/^ {2}release:[\s\S]*$/m);
const checkJob = block(/^ {2}check:[\s\S]*?(?=^ {2}publish:)/m);

test("publish.yml: triggers are only main (package.json or package generator changes), v* tags and workflow_dispatch", () => {
  const on = block(/^on:[\s\S]*?(?=^permissions:)/m);
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]\n {4}paths: \[package\.json, scripts\/npm-package\.ts, scripts\/installcheck\.ts, scripts\/npm-readme\.md\]\n {4}tags: \["v\*"\]/m);
  assert.match(on, /^ {2}workflow_dispatch:/m);
  assert.deepEqual([...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]), ["push", "workflow_dispatch"]);
  for (const bad of ["pull_request", "pull_request_target", "workflow_run"]) assert.ok(!code.includes(bad), bad);
});

test("publish.yml: a real manual run is allowed from main or its tag, with the same guards", () => {
  for (const s of ['"$REF_NAME" = "main"', "require('./package.json').version", 'v$VERSION', "a real publish runs on main", "merge-base --is-ancestor", "repoladder/repoladder", "REPO_PRIVATE"]) assert.ok(checkJob.includes(s), s);
  assert.match(checkJob, /\[ "\$PKG" = "\$VERSION" \]/);
  assert.ok(!code.includes("a real publish must run on the tag"));
});

test("publish.yml: no token or secret, OIDC only", () => {
  for (const bad of ["NPM_TOKEN", "secrets.", "_authToken", ".npmrc"]) assert.ok(!code.includes(bad), bad);
});

test("publish.yml: id-token: write only in the publish job; default is contents: read", () => {
  const top = block(/^permissions:\n(?: {2}.+\n)+/m);
  assert.equal(top.trim(), "permissions:\n  contents: read");
  assert.equal(code.match(/id-token: write/g)?.length, 1);
  assert.ok(publishJob.includes("id-token: write"));
  assert.ok(!checkJob.includes("id-token"));
});

test("publish.yml: publish is gated behind check, picks its environment from the bump, and uses provenance", () => {
  assert.match(publishJob, /needs: check/);
  assert.ok(publishJob.includes("environment: ${{ needs.check.outputs.bump == 'major' && 'npm-publish-major' || 'npm-publish' }}"));
  assert.equal(code.match(/npm-publish-major/g)?.length, 1);
  assert.equal(code.match(/npm-publish(?!-major)/g)?.length, 1);
  assert.match(checkJob, /^ {6}bump: \$\{\{ steps\.decide\.outputs\.bump \}\}$/m);
  assert.match(checkJob, /node scripts\/versionbump\.ts/);
  assert.match(publishJob, /needs\.check\.outputs\.dry == 'false'/);
  assert.match(publishJob, /npm publish [^\n]*--provenance/);
  assert.match(checkJob, /npm publish --dry-run/);
  assert.match(checkJob, /installcheck\.ts --pack/);
});

test("publish.yml: check skips a tag pushed outside the public repo", () => {
  assert.match(checkJob, /if: github\.event_name != 'push' \|\| \(github\.repository == 'repoladder\/repoladder' && github\.event\.repository\.private == false\)/);
});

test("publish.yml: guards are present", () => {
  for (const s of ["repoladder/repoladder", "merge-base --is-ancestor", "[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$", "--tag"]) assert.ok(code.includes(s), s);
  assert.match(code, /\*-\*\) TAG=next/);
  assert.match(code, /TAG=latest/);
});

test("publish.yml: actions are SHA-pinned and checkout keeps no credentials", () => {
  const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
  const checkouts = [...code.matchAll(/uses: actions\/checkout@[^\n]*\n {8}with:\n((?: {10}.+\n)+)/g)];
  assert.equal(checkouts.length, 3);
  for (const c of checkouts) assert.match(c[1], /persist-credentials: false/);
});

test("publish.yml: only the release job writes contents; it runs after publish and starts no publish", () => {
  assert.match(releaseJob, /needs: \[check, publish\]/);
  assert.match(releaseJob, /contents: write/);
  assert.equal(code.match(/contents: write/g)?.length, 1);
  assert.ok(!publishJob.includes("contents: write") && !checkJob.includes("contents: write"));
  assert.ok(!releaseJob.includes("id-token"));
});

test("publish.yml: a version already on npm is skipped, not republished", () => {
  assert.match(code, /npm view "repoladder@\$VERSION" version/);
  assert.match(publishJob.split("steps:")[0], /needs\.check\.outputs\.exists == 'false'/);
});
