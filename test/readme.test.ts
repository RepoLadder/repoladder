import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const SITE = "https://repoladder.com";
const HEADING = "## See it on a real repo";

type Demo = { name: string; url: string };

/** One message per problem in the README's "See it on a real repo" section. */
export function readmeDemoProblems(readme: string, demos: Demo[]): string[] {
  const start = readme.indexOf(HEADING);
  if (start < 0) return [`missing section "${HEADING}"`];
  const rest = readme.slice(start + HEADING.length);
  const next = rest.search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next);
  const problems: string[] = [];
  const rows = section.split("\n").filter((l) => l.startsWith("| ["));
  if (rows.length !== demos.length) problems.push(`expected ${demos.length} table rows, found ${rows.length}`);
  demos.forEach((d, i) => {
    const row = rows[i] ?? "";
    if (!row.includes(`](${d.url})`)) problems.push(`row ${i + 1} should link ${d.url}`);
    if (!row.includes(`](${SITE}/demo/${d.name}/)`)) problems.push(`row ${i + 1} should link ${SITE}/demo/${d.name}/`);
  });
  if (!section.includes(`[Browse all maps](${SITE}/browse)`)) problems.push("missing the Browse all maps link");
  if (/coming soon|DEMO_\d|NAME itself|#212/i.test(section)) problems.push("a placeholder is still present");
  const names = new Set(demos.map((d) => d.name));
  for (const m of section.matchAll(/https:\/\/repoladder\.com[^\s)]*/g)) {
    const url = m[0];
    const demo = url.match(/^https:\/\/repoladder\.com\/demo\/([^/]+)\/$/);
    if (url !== `${SITE}/browse` && !(demo && names.has(demo[1]))) problems.push(`unexpected link ${url}`);
  }
  return problems;
}

const readme = readFileSync(root + "README.md", "utf8");
const demos: Demo[] = JSON.parse(readFileSync(root + "gallery/demos.json", "utf8"));

test("README demo section matches gallery/demos.json", () => {
  assert.deepEqual(readmeDemoProblems(readme, demos), []);
});

const rowLines = readme.split("\n").filter((l) => l.startsWith("| ["));

test("a dropped row is reported", () => {
  assert.notEqual(readmeDemoProblems(readme.replace(rowLines[1] + "\n", ""), demos).length, 0);
});

test("swapped rows are reported", () => {
  const swapped = readme.replace(rowLines[0], "@@A@@").replace(rowLines[1], rowLines[0]).replace("@@A@@", rowLines[1]);
  assert.notEqual(readmeDemoProblems(swapped, demos).length, 0);
});

test("a wrong diagram URL is reported", () => {
  assert.notEqual(readmeDemoProblems(readme.replace("/demo/taxonomy/", "/demo/taxonomy-x/"), demos).length, 0);
});

test("a restored placeholder is reported", () => {
  assert.notEqual(readmeDemoProblems(readme.replace(HEADING + "\n", HEADING + "\n\n_coming soon_\n"), demos).length, 0);
});

test("a missing Browse link is reported", () => {
  assert.notEqual(readmeDemoProblems(readme.replace("[Browse all maps](https://repoladder.com/browse)", ""), demos).length, 0);
});
