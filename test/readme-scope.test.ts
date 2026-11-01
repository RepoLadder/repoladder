import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const HEADING = "## What it does and doesn't do";
const LABELS = [
  "Languages",
  "Drawn from the code",
  "Only named by the AI",
  "Runs on your machine",
  "Time",
  "Tokens",
  "Without AI",
  "Known limits",
];
const FIGURES = ["~300 files", "500 files", "6K", "16K"];
const BANNED = /\b(faster|better|unlike|only tool|alternative)\b/i;

/** One message per problem in the README's scope table section. */
export function scopeProblems(readme: string, reliability: string): string[] {
  const problems: string[] = [];
  const count = readme.split(HEADING).length - 1;
  if (count !== 1) return [`expected one "${HEADING}" heading, found ${count}`];
  const start = readme.indexOf(HEADING);
  const demo = readme.indexOf("## See it on a real repo");
  const install = readme.indexOf("## Install");
  if (!(demo >= 0 && demo < start && start < install)) problems.push("section must sit after the demo section and before Install");
  const rest = readme.slice(start + HEADING.length);
  const next = rest.search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next);
  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  const labels = rows.map((r) => /^\|\s*\*\*(.+?)\*\*/.exec(r)?.[1]).filter(Boolean);
  for (const l of LABELS) if (!labels.includes(l)) problems.push(`missing row "${l}"`);
  if (labels.length !== LABELS.length) problems.push(`expected ${LABELS.length} labelled rows, found ${labels.length}`);
  if (rows.some((r) => r.startsWith("| ["))) problems.push('a row starts with "| ["');
  if (BANNED.test(section)) problems.push("comparison or superlative wording");
  for (const f of FIGURES) {
    if (!section.includes(f)) problems.push(`section lacks figure ${f}`);
    if (!reliability.includes(f)) problems.push(`reliability.md lacks figure ${f}`);
  }
  const row = (l: string) => rows.find((r) => r.startsWith(`| **${l}**`)) ?? "";
  if (!row("Known limits").includes("docs/reliability.md")) problems.push("Known limits must link docs/reliability.md");
  if (!row("Runs on your machine").includes("PRIVACY.md#where-things-run")) problems.push("Runs on your machine must link PRIVACY.md#where-things-run");
  if (readme.includes("## What it costs")) problems.push('"## What it costs" is still present');
  if (!readme.includes("## Why you can trust the arrows")) problems.push("trust section is missing");
  return problems;
}

const readme = readFileSync(`${root}README.md`, "utf8");
const reliability = readFileSync(`${root}docs/reliability.md`, "utf8");

test("README scope table is valid", () => {
  assert.deepEqual(scopeProblems(readme, reliability), []);
});

test("removing a row fails", () => {
  const mutated = readme.replace(/^\| \*\*Tokens\*\*.*\n/m, "");
  assert.ok(scopeProblems(mutated, reliability).length > 0);
});

test("adding a comparison word fails", () => {
  const mutated = readme.replace("groups by folders", "groups by folders, faster than others");
  assert.ok(scopeProblems(mutated, reliability).length > 0);
});

test("reintroducing the costs heading fails", () => {
  const mutated = readme.replace("## Install", "## What it costs\n\n## Install");
  assert.ok(scopeProblems(mutated, reliability).length > 0);
});
