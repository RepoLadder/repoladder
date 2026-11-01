import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LANDING_URL } from "../src/build/brand.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SNIPPET = /\[!\[[^\]]*\]\((https:\/\/img\.shields\.io\/[^)\s]+)\)\]\(([^)\s]+)\)/;

/** Problems with the badge page and the README header; empty when fine. */
export function badgeProblems(page: string, readme: string, demos: string[]): string[] {
  const out: string[] = [];
  if (page.split("\n").filter((l) => /^# /.test(l)).length !== 1) out.push("page needs exactly one H1");
  const fence = /```markdown\n([\s\S]*?)```/.exec(page);
  const m = fence ? SNIPPET.exec(fence[1]) : null;
  if (!m) return [...out, "no fenced markdown image-link snippet"];
  const [, img, link] = m;
  if (link !== `${LANDING_URL}browse`) out.push(`snippet links to ${link}`);
  const demo = [...page.matchAll(/https:\/\/repoladder\.com\/demo\/([^/)\s]+)\//g)].map((x) => x[1]);
  if (!demo.some((n) => demos.includes(n))) out.push("no hosted demo link from gallery/demos.json");
  const header = readme.split("\n## ")[0];
  if (!header.includes(img)) out.push("README header lacks the badge image");
  if (!header.includes(`href="${link}"`)) out.push("README header lacks the badge link");
  if (!/\]\(docs\/badge\.md\)/.test(readme)) out.push("README does not link docs/badge.md");
  return out;
}

const page = read("docs/badge.md");
const readme = read("README.md");
const demos = (JSON.parse(read("gallery/demos.json")) as { name: string }[]).map((d) => d.name);

test("badge page and README badge are consistent", () => {
  assert.deepEqual(badgeProblems(page, readme, demos), []);
});

test("a snippet pointing at another host fails", () => {
  const bad = page.replace(`${LANDING_URL}browse)`, "https://example.com/)");
  assert.ok(badgeProblems(bad, readme, demos).length > 0);
});

test("a missing README badge fails", () => {
  const bad = readme.replace(/<a href="https:\/\/repoladder\.com\/browse"><img alt="RepoLadder map"[^\n]*\n/, "");
  assert.ok(badgeProblems(page, bad, demos).length > 0);
});
