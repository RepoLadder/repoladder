import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const FILES = [
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/pull_request_template.md",
];
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("issue forms have name, description and body, and set no labels", () => {
  const dir = new URL("../.github/ISSUE_TEMPLATE/", import.meta.url);
  const forms = readdirSync(dir).filter((f) => f.endsWith(".yml") && f !== "config.yml");
  assert.ok(forms.includes("bug.yml"));
  for (const f of forms) {
    const text = read(`.github/ISSUE_TEMPLATE/${f}`);
    const lines = text.split("\n");
    assert.ok(lines.some((l) => /^name: \S/.test(l)), `${f} name`);
    assert.ok(lines.some((l) => /^description: \S/.test(l)), `${f} description`);
    assert.ok(lines.some((l) => /^body:$/.test(l)), `${f} body`);
    assert.ok(!lines.some((l) => /^\s*labels:/.test(l)), `${f} sets labels`);
    assert.ok(!text.includes("\t"), `${f} has a tab`);
    const types = [...text.matchAll(/^\s*- type: (\S+)/gm)].map((m) => m[1]);
    for (const t of types) assert.match(t, /^(markdown|textarea|input|dropdown|checkboxes)$/, `${f} type ${t}`);
    const ids = [...text.matchAll(/^\s+id: (\S+)/gm)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${f} duplicate id`);
  }
});

test("feedback.yml still exists", () => {
  assert.ok(existsSync(new URL("../.github/ISSUE_TEMPLATE/feedback.yml", import.meta.url)));
});

test("config.yml keeps blank issues and links Discussions", () => {
  const text = read(".github/ISSUE_TEMPLATE/config.yml");
  assert.match(text, /^blank_issues_enabled: true$/m);
  assert.ok(text.includes("https://github.com/repoladder/repoladder/discussions"));
});

test("community files use the final names", () => {
  // Built from parts so a repo-wide grep for the old name stays clean.
  const OLD = new RegExp(["code", "wehb"].join(""), "i");
  for (const f of FILES) assert.ok(!OLD.test(read(f)), `${f} has the old name`);
  for (const f of FILES) assert.ok(!/gallery\/local\.json/.test(read(f)), `${f} mentions the local gallery file`);
  const sec = read("SECURITY.md");
  assert.ok(sec.includes("security@repoladder.com"));
  assert.ok(sec.includes("PRIVACY.md"));
});

test("community files name no license", () => {
  for (const f of FILES) assert.ok(!/\b(MIT|ISC|Apache|GPL|BSD)\b/.test(read(f)), `${f} names a license`);
});
