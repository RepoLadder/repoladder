import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

function section(readme: string, heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = readme.slice(start + heading.length + 2);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Every `/plugin ...` and `npx repoladder ...` command in a block of markdown, trailing `# comment` removed. */
export function commands(md: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const c = s.replace(/\s+#.*$/, "").trim();
    if (/^(\/plugin |npx repoladder )/.test(c)) out.push(c);
  };
  let fenced = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) add(line);
    else for (const m of line.matchAll(/`([^`]+)`/g)) add(m[1]);
  }
  return out;
}

const ANCHORS: Array<{ row: RegExp; file: string; needle: string }> = [
  { row: /^\| `\/map` \|/, file: "plugin/skills/map/SKILL.md", needle: "Publish `REPO/.repoladder/diagram.html` with the Artifact tool" },
  { row: /^\| `\/map path\/to\/repo` \|/, file: "plugin/skills/map/SKILL.md", needle: 'argument-hint: "[repo path]"' },
  { row: /^\| `\/map` again/, file: "plugin/skills/map/SKILL.md", needle: "keep its structure, ids, names and summaries" },
  { row: /regroup/, file: "plugin/skills/map/SKILL.md", needle: "regroup" },
  { row: /export/, file: "plugin/skills/map/SKILL.md", needle: "## Optional: export images" },
  { row: /usage stats/, file: "PRIVACY.md", needle: "usage no" },
];

/** One message per problem in the README's Install and Quick start sections. */
export function installProblems(readme: string, install: string, npmReadme: string): string[] {
  const p: string[] = [];
  const inst = section(readme, "## Install");
  const quick = section(readme, "## Quick start");
  if (!inst) p.push("missing ## Install");
  if (!quick) p.push("missing ## Quick start");
  if (readme.indexOf("\n## Quick start\n") < readme.indexOf("\n## Install\n")) p.push("Quick start should follow Install");
  const docs = new Set([...commands(install), ...commands(npmReadme)]);
  const known = (c: string) => docs.has(c);
  for (const c of commands(inst + "\n" + quick)) if (!known(c)) p.push(`command not documented: ${c}`);
  const plug = commands(inst).filter((c) => c.startsWith("/plugin "));
  const docPlug = commands(install).filter((c) => c.startsWith("/plugin ")).slice(0, plug.length);
  if (plug.join("\n") !== docPlug.join("\n")) p.push("plugin commands differ from docs/install.md");
  if (!inst.includes("Node.js 20.6")) p.push("missing Node.js 20.6");
  if (!install.includes("Node.js 20.6")) p.push("docs/install.md no longer says Node.js 20.6");
  const rows = quick.split("\n").filter((l) => l.startsWith("| ") && !/^\| (Try|---)/.test(l));
  if (rows.length === 0) p.push("no prompt rows");
  for (const row of rows) {
    const a = ANCHORS.find((x) => x.row.test(row));
    if (!a) p.push(`prompt row has no anchor: ${row}`);
    else if (!read(a.file).includes(a.needle)) p.push(`anchor missing in ${a.file}: ${a.needle}`);
  }
  return p;
}

const readme = read("README.md");
const install = read("docs/install.md");
const npm = read("scripts/npm-readme.md");

test("README Install and Quick start match the docs", () => {
  assert.deepEqual(installProblems(readme, install, npm), []);
});

test("a command that differs by one flag is reported", () => {
  const bad = readme.replace("\nnpx repoladder build . --default\n", "\nnpx repoladder build . --defaults\n");
  assert.notEqual(installProblems(bad, install, npm).length, 0);
});

test("a prompt row with no anchor is reported", () => {
  const bad = readme.replace("| `/map path/to/repo` |", "| `/map` with a surprise |").replace("Maps another folder.", "x");
  assert.notEqual(installProblems(bad, install, npm).length, 0);
});

test("a missing Node version is reported", () => {
  assert.notEqual(installProblems(readme.replace("Node.js 20.6", "Node.js"), install, npm).length, 0);
});
