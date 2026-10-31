import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

type Rule = { pattern: string; owners: string[] };

function parse(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (/[![\\?]/.test(pattern)) throw new Error(`unsupported CODEOWNERS syntax: ${pattern}`);
    rules.push({ pattern, owners });
  }
  return rules;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  let p = pattern.replace(/^\//, "");
  const dir = p.endsWith("/");
  if (dir) p = p.slice(0, -1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+^${}()|]/g, "\\$&");
  }
  const prefix = anchored ? "^" : "(?:^|/)";
  return new RegExp(`${prefix}${re}${dir ? "/.*" : "(?:/.*)?"}$`);
}

function matches(pattern: string, path: string): boolean {
  return toRegExp(pattern).test(path);
}

function ownersOf(rules: Rule[], path: string): string[] {
  let owners: string[] = [];
  for (const r of rules) if (matches(r.pattern, path)) owners = r.owners;
  return owners;
}

const text = readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8");
const rules = parse(text);
const OWNER = "@qtwehby";

// Sibling tickets append their new guardrail paths here.
const GUARDRAILS = [
  ".github/CODEOWNERS",
  ".github/workflows/ci.yml",
  ".github/workflows/publish.yml",
  ".github/workflows/rebuild-dist.yml",
  ".claude-plugin/marketplace.json",
  "plugin/.claude-plugin/plugin.json",
  "package.json",
  "package-lock.json",
  "plugin/package.json",
  "plugin/package-lock.json",
  "plugin/dist/repoladder.mjs",
  "plugin/skills/map/SKILL.md",
  ".githooks/pre-push",
  ".gitleaks.toml",
  "scripts/build.ts",
  "scripts/bundle.ts",
  "scripts/cichanges.ts",
  "scripts/npm-package.ts",
  "scripts/installcheck.ts",
  "scripts/githooks.ts",
  "scripts/leakguard.ts",
  "scripts/leakguard.config.json",
  "scripts/leakguard.private.json",
  "CLAUDE.md",
  "NOTICE",
  "test/releaseflow.test.ts",
  "test/cichanges.test.ts",
  "test/leakguard.test.ts",
  "test/codeowners.test.ts",
];

test("every rule names at least one owner, and only the maintainer", () => {
  assert.ok(rules.length > 0);
  for (const r of rules) {
    assert.ok(r.owners.length >= 1, `${r.pattern} has no owner`);
    assert.deepEqual(r.owners, [OWNER], `${r.pattern} owners`);
  }
});

test("no catch-all pattern", () => {
  for (const r of rules) assert.ok(!["*", "/*", "**", "/**"].includes(r.pattern), r.pattern);
});

test("guardrail paths are owned", () => {
  for (const p of GUARDRAILS) assert.deepEqual(ownersOf(rules, p), [OWNER], p);
});

test("listed guardrail files still exist", () => {
  for (const p of GUARDRAILS) {
    if (p.startsWith("plugin/dist/")) continue;
    assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `${p} was renamed or removed: update GUARDRAILS and CODEOWNERS`);
  }
});

test("ordinary files stay unowned", () => {
  for (const p of ["README.md", "src/cli.ts", "test/community.test.ts"]) {
    assert.deepEqual(ownersOf(rules, p), [], p);
  }
});

test("matcher: last match wins, dirs recurse, * stays in a segment", () => {
  const two = parse("/a/ @x\n/a/b/ @y\n");
  assert.deepEqual(ownersOf(two, "a/b/c"), ["@y"]);
  assert.deepEqual(ownersOf(two, "a/z"), ["@x"]);
  assert.ok(matches("/a/", "a/b/c"));
  assert.ok(!matches("/a/*.ts", "a/b/c.ts"));
  assert.ok(matches("/a/*.ts", "a/c.ts"));
  assert.ok(matches("*.md", "docs/x.md"));
  assert.throws(() => parse("!/a/ @x"));
});
