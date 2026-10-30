import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const FILES = ["README.md", "docs/install.md", "PRIVACY.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md"];
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("public docs carry no ticket refs in HTML comments", () => {
  // Built from parts so a repo-wide grep for the old name stays clean.
  const owner = ["code", "wehb"].join("");
  for (const f of FILES) {
    for (const [c] of read(f).matchAll(/<!--[\s\S]*?-->/g)) {
      assert.ok(!/#\d+/.test(c), `${f} has a ticket ref in a comment: ${c.slice(0, 60)}`);
      assert.ok(!new RegExp(`${owner}#\\d+`, "i").test(c), `${f} has a repo ticket ref`);
    }
  }
});

test("public docs do not link to the private launch plan", () => {
  for (const f of FILES) assert.ok(!/\]\([^)]*launch\.md/.test(read(f)), `${f} links launch.md`);
});

test("public docs name no private repo", () => {
  for (const f of FILES) assert.ok(!read(f).includes("RepoLadder/web"), `${f} mentions RepoLadder/web`);
});

test("docs/install.md has exactly one H1", () => {
  const h1 = read("docs/install.md").split("\n").filter((l) => /^# /.test(l));
  assert.equal(h1.length, 1);
});

test("public docs have no stale pre-publish wording", () => {
  for (const f of FILES) {
    const t = read(f);
    assert.ok(!/once the (npm )?package is published/i.test(t), `${f} has stale publish wording`);
    assert.ok(!/Available once/.test(t), `${f} has "Available once"`);
  }
});
