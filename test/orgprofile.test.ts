import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const PROMISE = "Understand the codebase your AI just wrote, in minutes.";
const INSTALL = ["/plugin marketplace add repoladder/repoladder", "/plugin install repoladder@repoladder"];
const GH = "https://github.com/repoladder/repoladder";
const FIXED = ["https://repoladder.com", "https://repoladder.com/browse", GH, `${GH}/issues`, `${GH}/discussions`];
const EM_DASH = String.fromCharCode(0x2014);
const FORBIDDEN = [
  ["code", "wehb"].join(""),
  ["Front", "Desk"].join(""),
  [" L", "LC"].join(""),
  ["server", "ping"].join("/"),
  ["/Us", "ers/"].join(""),
  ["docs", "launch"].join("/"),
  ["Repo", "Ladder/web"].join(""),
];

/** One message per problem in a public org-profile doc. */
export function sharedProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.includes(EM_DASH)) problems.push("contains an em dash");
  for (const t of FORBIDDEN) if (text.toLowerCase().includes(t.toLowerCase())) problems.push(`contains forbidden term ${t}`);
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) problems.push("contains an email address");
  return problems;
}

/** One message per problem in the org profile README. */
export function orgProfileProblems(text: string, demos: { name: string }[]): string[] {
  const problems = sharedProblems(text);
  if (!text.startsWith("# RepoLadder\n")) problems.push("should open with the title RepoLadder");
  if (!text.includes(PROMISE)) problems.push("missing the site promise");
  for (const l of INSTALL) if (!text.includes(l)) problems.push(`missing install line ${l}`);
  if (!text.includes("`/map`")) problems.push("missing /map");
  if (text.includes("<!--")) problems.push("contains an HTML comment");
  const names = new Set(demos.map((d) => d.name));
  const urls = new Set<string>();
  for (const m of text.matchAll(/\]\(([^)\s]*)\)/g)) urls.add(m[1]);
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) urls.add(m[0]);
  for (const url of urls) {
    const demo = url.match(/^https:\/\/repoladder\.com\/demo\/([^/]+)\/$/);
    if (!url.startsWith("https://")) problems.push(`non-https or relative link ${url}`);
    else if (!FIXED.includes(url) && !(demo && names.has(demo[1]))) problems.push(`unexpected link ${url}`);
  }
  if (demos[0]) {
    const first = `https://repoladder.com/demo/${demos[0].name}/`;
    if (!text.includes(`](${first})`)) problems.push(`should link the first demo ${first}`);
  }
  if (!text.includes("](https://repoladder.com/browse)")) problems.push("should link /browse");
  return problems;
}

const readme = readFileSync(root + "docs/org-profile/README.md", "utf8");
const handoff = readFileSync(root + "docs/org-profile/HANDOFF.md", "utf8");
const demos: { name: string }[] = JSON.parse(readFileSync(root + "gallery/demos.json", "utf8"));

test("org profile README has no problems", () => {
  assert.deepEqual(orgProfileProblems(readme, demos), []);
});

test("org profile README links the first demo", () => {
  assert.ok(readme.includes(`https://repoladder.com/demo/${demos[0].name}/`));
});

test("HANDOFF.md is public-safe", () => {
  assert.deepEqual(sharedProblems(handoff), []);
});

test("HANDOFF.md lists the owner steps and README does not", () => {
  for (const s of ["repoladder/.github", "profile/README.md", "Pin", "avatar", "Enable Discussions", "click every link"]) {
    assert.ok(handoff.includes(s), `HANDOFF.md missing ${s}`);
  }
  assert.ok(!readme.includes("profile/README.md"));
  assert.ok(!readme.includes("avatar"));
});

test("negative cases each produce a problem", () => {
  const bad = (s: string) => orgProfileProblems(readme + "\n" + s, demos);
  assert.ok(bad("[x](docs/install.md)").length > 0);
  assert.ok(bad("https://example.com/x").length > 0);
  assert.ok(bad("<!-- note -->").length > 0);
  assert.ok(bad(`a ${EM_DASH} b`).length > 0);
  assert.ok(bad(FORBIDDEN[0]).length > 0);
  assert.ok(bad("mailto:a@b.co").length > 0);
  assert.ok(orgProfileProblems(readme.replace(PROMISE, "x"), demos).length > 0);
});
