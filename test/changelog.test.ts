import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Sections of a changelog: heading line and body lines up to the next `## ` heading. */
function sections(text: string): { heading: string; body: string[] }[] {
  const out: { heading: string; body: string[] }[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) out.push({ heading: line, body: [] });
    else out.at(-1)?.body.push(line);
  }
  return out;
}

/** The awk rule from publish.yml: the lines between `## <version>` and the next `## `. */
function extract(text: string, version: string): string {
  let on = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line === `## ${version}`) { on = true; continue; }
    if (line.startsWith("## ")) on = false;
    if (on) out.push(line);
  }
  return out.join("\n");
}

/** Problems with the changelog's format, as the release workflow depends on it. */
export function changelogProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.startsWith("# Changelog")) problems.push("does not start with # Changelog");
  for (const s of sections(text)) {
    if (!/^## \d+\.\d+\.\d+$/.test(s.heading)) problems.push(`bad heading: ${s.heading}`);
    if (!s.body.some((l) => l.trim())) problems.push(`empty section: ${s.heading}`);
  }
  return problems;
}

test("the changelog format matches what the release workflow extracts", () => {
  assert.deepEqual(changelogProblems(read("CHANGELOG.md")), []);
});

test("a heading with a suffix fails", () => {
  assert.ok(changelogProblems("# Changelog\n\n## 0.2.0 (2026)\n\n- a\n").length > 0);
});

test("an empty section fails", () => {
  assert.ok(changelogProblems("# Changelog\n\n## 0.2.0\n\n## 0.1.0\n\n- a\n").length > 0);
});

test("the 0.2.0 notes are real and user-facing", () => {
  const body = extract(read("CHANGELOG.md"), "0.2.0");
  assert.ok(body.trim().length > 0, "extraction returns the 0.2.0 body");
  assert.ok(body.trim() !== "First release published from the public repo.");
  assert.ok(body.split("\n").filter((l) => l.startsWith("- ")).length >= 4, "at least four bullets");
  assert.ok(!/#\d+/.test(body), "ticket reference");
  assert.ok(!/^- [0-9a-f]{7}:/m.test(body), "commit hash prefix");
});

test("the publish workflow still extracts by the same rule", () => {
  assert.ok(read(".github/workflows/publish.yml").includes(`'$0 ~ "^## " v "$" {on=1; next} /^## / {on=0} on'`));
});

test("CONTRIBUTING.md documents the changelog and credit convention", () => {
  const text = read("CONTRIBUTING.md");
  assert.ok(text.includes("## Changelog and credit"));
  assert.ok(text.includes("npm run changeset"));
  assert.ok(text.includes("Thanks @"));
  assert.ok(!/\b(MIT|ISC|Apache|GPL|BSD)\b/.test(text), "names a license");
});
