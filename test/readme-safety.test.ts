import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const HEADING = "## Is it safe to install?";

// Each claim in the section -> the file that proves it. All must exist and be linked from the section.
const PROOFS = [
  "src/analyze/files.ts",
  "test/no-network.test.ts",
  ".github/workflows/publish.yml",
  "plugin/package-lock.json",
  "PRIVACY.md#where-things-run",
  "PRIVACY.md#usage-stats-off-unless-you-say-yes",
  "docs/install.md",
  "docs/development.md",
];

/** One message per problem in the README's "Is it safe to install?" section. */
export function safetyProblems(readme: string): string[] {
  const p: string[] = [];
  const count = readme.split("\n").filter((l) => l === HEADING).length;
  if (count !== 1) return [`expected one "${HEADING}" heading, found ${count}`];
  const start = readme.indexOf(HEADING);
  const install = readme.indexOf("\n## Install\n");
  if (install < 0 || install > start) p.push("section should come after ## Install");
  const rest = readme.slice(start + HEADING.length);
  const next = rest.search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next);
  for (const f of PROOFS) if (!section.includes(`](${f})`)) p.push(`section should link ${f}`);
  if (!section.includes("](PRIVACY.md)")) p.push("section should link PRIVACY.md");
  if (!readme.includes('<a href="#is-it-safe-to-install">Safe to install</a>')) p.push("header link row should link the section");
  return p;
}

/** Facts the section states, checked against the repo. */
export function factProblems(r: { lock: string; pluginDeps: Record<string, string>; publish: string; install: string }): string[] {
  const p: string[] = [];
  if (r.lock.includes("hasInstallScript")) p.push("plugin lockfile has a package with an install script");
  for (const [n, v] of Object.entries(r.pluginDeps)) if (!/^\d/.test(v)) p.push(`plugin dependency ${n} is not pinned: ${v}`);
  if (!r.publish.includes("npm publish --provenance")) p.push("publish workflow does not publish with provenance");
  if (!r.publish.includes("id-token: write")) p.push("publish workflow lacks id-token: write");
  if (!r.install.includes("--ignore-scripts")) p.push("plugin install does not pass --ignore-scripts");
  return p;
}

const readme = readFileSync(root + "README.md", "utf8");
const read = (f: string) => readFileSync(root + f, "utf8");

test("README safety section is complete and linked", () => {
  assert.deepEqual(safetyProblems(readme), []);
});

test("every proof file exists", () => {
  for (const f of PROOFS) assert.ok(existsSync(root + f.split("#")[0]!), f);
});

test("the claims hold in the repo", () => {
  assert.deepEqual(
    factProblems({
      lock: read("plugin/package-lock.json"),
      pluginDeps: JSON.parse(read("plugin/package.json")).dependencies,
      publish: read(".github/workflows/publish.yml"),
      install: read("src/install.ts"),
    }),
    [],
  );
});

test("a missing heading is reported", () => {
  assert.notEqual(safetyProblems(readme.replace(HEADING, "## Other")).length, 0);
});

test("a dropped PRIVACY link is reported", () => {
  assert.notEqual(safetyProblems(readme.replaceAll("](PRIVACY.md)", "](x)")).length, 0);
});

test("a missing header link is reported", () => {
  assert.notEqual(safetyProblems(readme.replace("#is-it-safe-to-install", "#nope")).length, 0);
});

test("an install script in the lockfile is reported", () => {
  const f = factProblems({ lock: '{"hasInstallScript": true}', pluginDeps: {}, publish: "npm publish --provenance id-token: write", install: "--ignore-scripts" });
  assert.equal(f.length, 1);
});
