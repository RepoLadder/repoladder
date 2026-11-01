import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const FILES = ["README.md", "docs/install.md", "docs/how-it-works.md", "docs/export.md", "docs/development.md", "CONTRIBUTING.md"];

/** GitHub's heading anchor: lowercase, no markdown, only letters, digits, spaces, - and _. Duplicates are numbered by headingsOf. */
export function githubSlug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/** The anchors a markdown file defines, in order; repeated headings get -1, -2. Fenced code is ignored. */
export function headingsOf(markdown: string): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const slug = githubSlug(m[1]);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    out.push(n === 0 ? slug : `${slug}-${n}`);
  }
  return out;
}

function targets(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(m[1]);
    for (const m of line.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) out.push(m[1]);
    for (const m of line.matchAll(/\bsrcset=["']([^"']+)["']/g)) {
      for (const part of m[1].split(",")) if (part.trim()) out.push(part.trim().split(/\s+/)[0]);
    }
  }
  return out;
}

/** One message per relative link, image or anchor in `text` (a file at repo path `file`) that points nowhere. */
export function docProblems(
  file: string,
  text: string,
  exists: (path: string) => boolean,
  headings: (path: string) => string[],
): string[] {
  const problems: string[] = [];
  for (const t of targets(text)) {
    if (/^(https?:|mailto:)/i.test(t)) continue;
    const [rawPath, anchor] = t.split("#") as [string, string | undefined];
    const path = rawPath === "" ? file : posix.normalize(posix.join(posix.dirname(file), rawPath));
    if (!exists(path)) {
      problems.push(`${file}: ${t} -> ${path} does not exist`);
      continue;
    }
    if (anchor !== undefined && anchor !== "" && path.endsWith(".md") && !headings(path).includes(anchor)) {
      problems.push(`${file}: ${t} -> no heading "${anchor}" in ${path}`);
    }
  }
  return problems;
}

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p: string) => existsSync(`${root}${p}`);
const headings = (p: string) => headingsOf(read(p));

test("relative links, images and anchors resolve in the README and docs pages", () => {
  for (const f of FILES) assert.deepEqual(docProblems(f, read(f), exists, headings), []);
});

test("the moved pages each have exactly one H1", () => {
  for (const f of ["docs/how-it-works.md", "docs/export.md", "docs/development.md"]) {
    assert.equal(read(f).split("\n").filter((l) => /^# /.test(l)).length, 1, f);
  }
});

test("githubSlug matches GitHub's anchors", () => {
  assert.equal(githubSlug("Is it safe to install?"), "is-it-safe-to-install");
  assert.equal(githubSlug("Usage stats: off unless you say yes"), "usage-stats-off-unless-you-say-yes");
  assert.equal(githubSlug("The `npx` [thing](x.md)"), "the-npx-thing");
});

test("headingsOf numbers repeats and skips fenced code", () => {
  assert.deepEqual(headingsOf("# A\n## A\n```\n# no\n```\n## A\n"), ["a", "a-1", "a-2"]);
});

test("a dangling file link is reported", () => {
  const p = docProblems("docs/x.md", "[a](missing.md) ![i](media/none.gif)", () => false, () => []);
  assert.equal(p.length, 2);
});

test("a dangling anchor is reported, a good one is not", () => {
  const h = () => ["real"];
  assert.equal(docProblems("README.md", "[a](#nope) [b](#real) [c](docs/y.md#nope)", () => true, h).length, 2);
  assert.deepEqual(docProblems("README.md", "[b](#real) [c](https://x.y/z#q) [d](mailto:a@b.c)", () => true, h), []);
});

test("html href, src and srcset are checked", () => {
  const p = docProblems("README.md", `<a href="a.md"></a><img src="b.png" srcset="c.png 1x, d.png 2x">`, () => false, () => []);
  assert.equal(p.length, 4);
});
