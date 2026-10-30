import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { githubSource, parseGithubRemote } from "../src/analyze/files.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { addSnippets, snippetAt, snippetKey } from "../src/model/snippets.ts";

const root = fileURLToPath(new URL("./fixtures/multi", import.meta.url));
const read = (f: string) => readFileSync(join(root, f), "utf8");
function model(): Model {
  const facts = analyze(root), g = defaultGrouping(facts);
  return buildModel(facts, g, assign(g, facts).leafOf);
}

test("GitHub remotes in every URL form; other hosts are not GitHub", () => {
  for (const url of [
    "https://github.com/excalidraw/excalidraw",
    "https://github.com/excalidraw/excalidraw.git",
    "https://token@github.com/excalidraw/excalidraw.git",
    "git@github.com:excalidraw/excalidraw.git",
    "ssh://git@github.com/excalidraw/excalidraw.git",
  ]) assert.equal(parseGithubRemote(url), "excalidraw/excalidraw", url);
  assert.equal(parseGithubRemote("git@github.com:o/my.repo.js.git"), "o/my.repo.js");
  assert.equal(parseGithubRemote("https://gitlab.com/o/r.git"), null);
  assert.equal(parseGithubRemote("https://github.com.evil.io/o/r"), null);
});

test("githubSource: full commit, the analyzed subdirectory, null without a GitHub remote", () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-gh-"));
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    git("init", "-q");
    mkdirSync(join(dir, "apps/web"), { recursive: true });
    writeFileSync(join(dir, "apps/web/a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    assert.equal(githubSource(dir), null);
    git("remote", "add", "upstream", "https://gitlab.com/o/r.git");
    assert.equal(githubSource(dir), null);
    git("remote", "add", "fork", "git@github.com:me/r.git");
    const sha = git("rev-parse", "HEAD");
    assert.deepEqual(githubSource(dir), { repo: "me/r", sha, dir: "" });
    git("remote", "add", "origin", "https://github.com/o/r");
    assert.deepEqual(githubSource(join(dir, "apps/web")), { repo: "o/r", sha, dir: "apps/web/" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snippetAt: three lines around the hit, dedented, blank edges dropped, long lines cut", () => {
  const text = ["function f() {", "    if (x) {", "      call();", "    }", "", "  done();", "}"].join("\n");
  assert.deepEqual(snippetAt(text, 3), [2, "if (x) {\n  call();\n}"]);
  assert.deepEqual(snippetAt(text, 1), [1, "function f() {\n    if (x) {"]);
  assert.deepEqual(snippetAt(text, 6), [6, "  done();\n}"]); // the blank line above is dropped
  assert.deepEqual(snippetAt(text, 7), [6, "  done();\n}"]);
  assert.equal(snippetAt(text, 0), null);
  assert.equal(snippetAt(text, 8), null);
  const [, long] = snippetAt(`x\n${"y".repeat(300)}\nz`, 2)!;
  assert.equal(long.split("\n")[1].length, 100);
  assert.ok(long.split("\n")[1].endsWith("…"));
});

test("addSnippets: every snippet holds its evidence line, from the real file", () => {
  const m = model();
  addSnippets(m, (f) => { try { return read(f); } catch { return null; } });
  const keys = Object.keys(m.snippets!);
  const ev = Object.values(m.boards).flatMap((b) => b.edges.flatMap((e) => e.ev));
  assert.equal(new Set(ev.map(([f, l]) => snippetKey(f, l))).size, keys.length, "small repo: all evidence fits");
  for (const [f, l] of ev) {
    const [start, text] = m.snippets![snippetKey(f, l)];
    const want = read(f).split("\n")[l - 1].trim();
    assert.equal(text.split("\n")[l - start].trim(), want, `${f}:${l}`);
  }
  assert.deepEqual(keys, [...keys].sort());
});

test("addSnippets: over budget, the first evidence of each edge comes first; unreadable files are skipped", () => {
  const m = model();
  const firsts = new Set(Object.values(m.boards).flatMap((b) => b.edges.map((e) => snippetKey(e.ev[0][0], e.ev[0][1]))));
  const sizes = [...firsts].map((k) => { const i = k.lastIndexOf(":"); return snippetAt(read(k.slice(0, i)), Number(k.slice(i + 1)))![1].length; });
  const budget = sizes.reduce((a, b) => a + b, 0);
  addSnippets(m, read, budget);
  assert.deepEqual(new Set(Object.keys(m.snippets!)), firsts);
  addSnippets(m, () => null);
  assert.deepEqual(m.snippets, {});
});

test("page data: GitHub link base and snippets keyed by path index", () => {
  const m = model();
  m.github = { repo: "o/r", sha: "a".repeat(40), dir: "apps/my web/" };
  addSnippets(m, read);
  const data = pageData(renderHtml(m, {}));
  assert.equal(data.gh, `https://github.com/o/r/blob/${"a".repeat(40)}/apps/my%20web/`);
  const [f, l] = m.boards.root.edges[0].ev[0];
  assert.deepEqual(data.snips[`${data.paths.indexOf(f)}:${l}`], m.snippets![snippetKey(f, l)]);
  m.github = null;
  m.snippets = {};
  const plain = pageData(renderHtml(m, {}));
  assert.ok(!("gh" in plain) && !("snips" in plain));
});
