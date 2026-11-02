import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const HEADING = "## Which agents work";
const ANCHOR = "docs/install.md#which-agents-work";
const NAMES = ["codex", "cursor", "copilot", "opencode", "gemini", "windsurf", "aider", "cline"];

const cells = (row: string): string[] =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** One message per problem in the "which agents work" docs. */
export function agentsProblems(install: string, readme: string, npmReadme: string): string[] {
  const problems: string[] = [];
  const count = install.split(`\n${HEADING}\n`).length - 1;
  if (count !== 1) return [`expected one "${HEADING}" heading, found ${count}`];
  const rest = install.slice(install.indexOf(`\n${HEADING}\n`) + HEADING.length + 1);
  const next = rest.search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next);
  const lines = section.split("\n").filter((l) => l.startsWith("|"));
  const header = lines[0] ? cells(lines[0]) : [];
  if (header.join("|") !== "Agent|Install|AI grouping tested") problems.push("table header must be Agent, Install, AI grouping tested");
  const rows = lines.slice(2).map(cells);
  for (const r of rows) if (!r[2]) problems.push(`row "${r[0]}" has an empty AI grouping result`);
  const claude = rows.find((r) => r[0] === "Claude Code");
  if (!claude || !(claude[2] ?? "").startsWith("Yes")) problems.push("Claude Code row must start with Yes");
  if (!readme.includes(ANCHOR)) problems.push(`README must link ${ANCHOR}`);
  if (!npmReadme.includes(ANCHOR)) problems.push(`npm readme must contain ${ANCHOR}`);
  const text = [install, readme, npmReadme].join("\n");
  for (const n of NAMES) {
    if (!new RegExp(`\\b${n}\\b`, "i").test(text)) continue;
    if (!rows.some((r) => new RegExp(`\\b${n}\\b`, "i").test(r[0] ?? ""))) problems.push(`${n} is mentioned but has no row in the agents table`);
  }
  return problems;
}

const install = readFileSync(`${root}docs/install.md`, "utf8");
const readme = readFileSync(`${root}README.md`, "utf8");
const npmReadme = readFileSync(`${root}scripts/npm-readme.md`, "utf8");

test("agents table is valid", () => {
  assert.deepEqual(agentsProblems(install, readme, npmReadme), []);
});

test("removing the section fails", () => {
  assert.ok(agentsProblems(install.replace(HEADING, "## Other"), readme, npmReadme).length > 0);
});

test("blank Claude Code result fails", () => {
  const m = install.replace(/(\| Claude Code \|.*\|) Yes \|/, "$1  |");
  assert.notEqual(m, install);
  assert.ok(agentsProblems(m, readme, npmReadme).length > 0);
});

test("an agent name without a row fails", () => {
  assert.ok(agentsProblems(install, `${readme}\nWorks with Codex.\n`, npmReadme).length > 0);
});

test("an agent name with a row passes", () => {
  const withRow = install.replace(/(\| No agent \(command line\).*\n)/, "$1| Codex | `x` | No |\n");
  assert.notEqual(withRow, install);
  assert.deepEqual(agentsProblems(withRow, `${readme}\nWorks with Codex.\n`, npmReadme), []);
});
