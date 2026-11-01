import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

type Pkg = { description: string; license: string };

/** The README header: the text before the first `## ` heading. */
export function headerOf(readme: string): string {
  const i = readme.indexOf("\n## ");
  return i < 0 ? readme : readme.slice(0, i);
}

/** One message per problem in the README header. */
export function headerProblems(header: string, pkg: Pkg, same: { light: boolean; dark: boolean }): string[] {
  const p: string[] = [];
  const pic = header.match(/<picture>[\s\S]*?<\/picture>/)?.[0] ?? "";
  if (!pic) p.push("missing <picture>");
  if (!/srcset="docs\/media\/logo-dark\.svg"/.test(pic)) p.push("dark srcset should be docs/media/logo-dark.svg");
  if (!/<img[^>]*src="docs\/media\/logo-light\.svg"/.test(pic)) p.push("img src should be docs/media/logo-light.svg");
  if (!header.includes(pkg.description)) p.push("tagline should equal package.json description");
  const badges = [...header.matchAll(/<img[^>]*\balt="([^"]*)"[^>]*\bsrc="([^"]*)"/g)].filter((m) => !m[2].startsWith("docs/"));
  if (badges.length < 4) p.push(`expected at least 4 badges, found ${badges.length}`);
  for (const prefix of ["License", "npm", "CI", "Node"]) {
    if (!badges.some((b) => b[1].startsWith(prefix))) p.push(`missing ${prefix} badge`);
  }
  const lic = badges.find((b) => b[1].startsWith("License"));
  if (lic && !lic[2].includes(pkg.license.replace(/-/g, "--"))) p.push(`license badge should name ${pkg.license}`);
  for (const b of badges) {
    if (!/^https:\/\/(img\.shields\.io\/|github\.com\/RepoLadder\/repoladder\/)/.test(b[2])) p.push(`unexpected badge host ${b[2]}`);
  }
  for (const link of ["https://repoladder.com/browse", "docs/install.md", "#documentation"]) {
    if (!header.includes(`href="${link}"`)) p.push(`link row should contain ${link}`);
  }
  for (const m of header.matchAll(/https:\/\/repoladder\.com[^\s"')]*/g)) {
    if (m[0] !== "https://repoladder.com/browse") p.push(`unexpected site link ${m[0]}`);
  }
  if (/#\d+/.test(header)) p.push("header has issue-number text");
  if (!same.light) p.push("docs/media/logo-light.svg should equal src/build/mark.svg");
  if (!same.dark) p.push("docs/media/logo-dark.svg should equal src/build/mark-dark.svg");
  return p;
}

const read = (f: string) => readFileSync(root + f);
const readme = read("README.md").toString("utf8");
const pkg: Pkg = JSON.parse(read("package.json").toString("utf8"));
const same = {
  light: read("docs/media/logo-light.svg").equals(read("src/build/mark.svg")),
  dark: read("docs/media/logo-dark.svg").equals(read("src/build/mark-dark.svg")),
};
const header = headerOf(readme);

test("README header is complete", () => {
  assert.deepEqual(headerProblems(header, pkg, same), []);
});

test("a dropped badge is reported", () => {
  const h = header.replace(/ *<a href="LICENSE">.*\n/, "");
  assert.notEqual(headerProblems(h, pkg, same).length, 0);
});

test("a changed tagline is reported", () => {
  assert.notEqual(headerProblems(header.replace("stay in sync", "stay fresh"), pkg, same).length, 0);
});

test("a dark logo pointing at the wrong file is reported", () => {
  assert.notEqual(headerProblems(header.replace('srcset="docs/media/logo-dark.svg"', 'srcset="docs/media/logo-light.svg"'), pkg, same).length, 0);
});

test("a drifted logo copy is reported", () => {
  assert.notEqual(headerProblems(header, pkg, { ...same, dark: false }).length, 0);
});

test("a missing link is reported", () => {
  assert.notEqual(headerProblems(header.replace('href="#documentation"', 'href="#docs"'), pkg, same).length, 0);
});
