import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Comments never count: drop whole-line comments and trailing `# ...`.
const strip = (t: string) =>
  t.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, "")).join("\n");
const yml = strip(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
const at = (s: string) => {
  const i = yml.indexOf(s);
  assert.ok(i >= 0, `release.yml lacks: ${s}`);
  return i;
};

test("the Version Packages PR is opened with RELEASE_PR_TOKEN so its CI starts on its own", () => {
  const action = at("changesets/action");
  const token = at("github-token: ${{ secrets.RELEASE_PR_TOKEN }}");
  assert.ok(token > action, "the PAT is the changesets step's token");
  assert.ok(!yml.includes("gh workflow run ci.yml"), "no manual CI dispatch: the PR's own pull_request CI is the gate");
  at("actions: write");
  at("timeout-minutes: 60");
});

test("a minor or patch PR gets auto-merge, a major does not", () => {
  const merge = at("gh pr merge");
  assert.match(yml.slice(merge, merge + 120), /--auto --merge/);
  const major = at('"${NEW%%.*}" != "${OLD%%.*}"');
  assert.ok(major < merge, "the major check comes before the merge");
  assert.match(yml.slice(major, merge), /merge=false/);
});

test("auto-merge is refused when main requires no checks", () => {
  assert.ok(at("rules/branches/main") < at("gh pr merge"));
  assert.match(yml, /required_status_checks/);
});

test("the publish is dispatched from main after the wait step", () => {
  const wait = at("Wait for the merge");
  const pub = at("gh workflow run publish.yml");
  assert.ok(pub > wait);
  const line = yml.slice(pub, yml.indexOf("\n", pub));
  assert.match(line, /--ref main/);
  assert.match(line, /dry-run=false/);
});

test("no secret other than GITHUB_TOKEN and RELEASE_PR_TOKEN is used", () => {
  const used = [...yml.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(used.filter((n) => n !== "GITHUB_TOKEN" && n !== "RELEASE_PR_TOKEN"), []);
});

test("the merge and publish steps keep the built-in token", () => {
  // A merge made with the PAT would also start publish.yml by push.
  const merge = at("gh pr merge");
  assert.ok(!yml.slice(merge - 400, merge).includes("RELEASE_PR_TOKEN"), "the auto-merge step does not use the PAT");
  assert.equal(yml.split("RELEASE_PR_TOKEN").length - 1, 1, "the PAT is used in exactly one place");
});
