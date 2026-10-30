import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { buildFromFiles } from "../src/lib.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const FULL = "0123456789abcdef0123456789abcdef01234567";

function tmp<T>(f: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "cw-nogit-"));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const bare = (f: ReturnType<typeof analyze>) => { const c = { ...f } as Partial<typeof f>; delete c.sha; delete c.github; return JSON.stringify(c); };
function copyFixture(name: string, into: string): string {
  const dst = join(into, name);
  cpSync(join(fixtures, name), dst, { recursive: true });
  return dst;
}

test("AC1: a copy of every fixture with no .git analyzes like the fixture, with no sha or link", () => {
  for (const name of readdirSync(fixtures)) {
    tmp((d) => {
      const copy = copyFixture(name, d);
      const a = analyze(copy);
      assert.equal(bare(a), bare(analyze(join(fixtures, name))), name);
      assert.equal(a.sha, null, name);
      assert.equal(a.github, null, name);
    });
  }
});

test("AC2: git:off and the memory path never spawn git", { skip: process.platform === "win32" }, () => {
  return tmp((d) => {
    const copy = copyFixture("basic-app", d);
    mkdirSync(join(d, "bin"));
    writeFileSync(join(d, "bin/git"), '#!/bin/sh\necho x >> "$CW_GIT_MARK"\nexit 1\n');
    chmodSync(join(d, "bin/git"), 0o755);
    const mark = join(d, "mark");
    const oldPath = process.env.PATH;
    process.env.CW_GIT_MARK = mark;
    process.env.PATH = `${join(d, "bin")}:${oldPath}`;
    try {
      const f = analyze(copy, { git: "off" });
      assert.equal(f.sha, null);
      assert.equal(f.github, null);
      assert.ok(f.files.length > 0);
      assert.equal(existsSync(mark), false);
      analyze(copy);
      assert.equal(existsSync(mark), true);
      rmSync(mark);
      return buildFromFiles({ "src/a.ts": "export const a = 1;\n" }).then(() => assert.equal(existsSync(mark), false)).finally(() => {
        process.env.PATH = oldPath;
        delete process.env.CW_GIT_MARK;
      });
    } catch (e) {
      process.env.PATH = oldPath;
      delete process.env.CW_GIT_MARK;
      throw e;
    }
  });
});

test("AC3: a folder inside another repo that tracks nothing under it is plain", () => {
  tmp((d) => {
    const outer = join(d, "outer");
    mkdirSync(outer);
    git(outer, "init", "-q");
    writeFileSync(join(outer, "x.txt"), "x");
    writeFileSync(join(outer, ".gitignore"), "extract/\n");
    git(outer, "add", ".");
    git(outer, "commit", "-qm", "i");
    git(outer, "remote", "add", "origin", "https://github.com/o/outer.git");
    mkdirSync(join(outer, "extract"));
    mkdirSync(join(outer, "loose"));
    const ignored = copyFixture("basic-app", join(outer, "extract"));
    const loose = copyFixture("basic-app", join(outer, "loose"));
    const clean = analyze(copyFixture("basic-app", d));
    for (const p of [ignored, loose]) {
      const f = analyze(p);
      assert.equal(JSON.stringify(f), JSON.stringify(clean));
      assert.equal(f.sha, null);
      assert.equal(f.github, null);
    }
  });
});

test("AC4: git is still used for a monorepo subdir and for a repo with no commits", () => {
  tmp((d) => {
    const r = join(d, "mono");
    mkdirSync(join(r, "apps/web"), { recursive: true });
    git(r, "init", "-q");
    writeFileSync(join(r, "apps/web/a.ts"), "export const a = 1;\n");
    git(r, "add", ".");
    git(r, "commit", "-qm", "i");
    git(r, "remote", "add", "origin", "https://github.com/o/r");
    const f = analyze(join(r, "apps/web"));
    assert.equal(f.github?.dir, "apps/web/");
    assert.equal(f.github?.sha, git(r, "rev-parse", "HEAD"));
    assert.equal(f.sha, git(r, "rev-parse", "--short", "HEAD"));

    const fresh = join(d, "fresh");
    mkdirSync(join(fresh, "src"), { recursive: true });
    git(fresh, "init", "-q");
    writeFileSync(join(fresh, ".gitignore"), "gen.ts\n");
    writeFileSync(join(fresh, "src/a.ts"), "export const a = 1;\n");
    writeFileSync(join(fresh, "gen.ts"), "export const g = 1;\n");
    assert.deepEqual(analyze(fresh).files.map((x) => x.path), ["src/a.ts"]);
  });
});

test("AC5: overrides win and feed the code links", () => {
  tmp((d) => {
    const copy = copyFixture("basic-app", d);
    const github = { repo: "o/r", sha: FULL, dir: "" };
    const f = analyze(copy, { sha: FULL, github });
    assert.equal(f.sha, FULL.slice(0, 7));
    assert.equal(f.github?.sha, FULL);
    const g = defaultGrouping(f);
    const m = buildModel(f, g, assign(g, f).leafOf);
    assert.equal(pageData(renderHtml(m, {})).gh, `https://github.com/o/r/blob/${FULL}/`);
    assert.equal(analyze(copy, { github }).sha, FULL.slice(0, 7));

    const repo = join(d, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "i");
    git(repo, "remote", "add", "origin", "https://github.com/o/r");
    const n = analyze(repo, { sha: null });
    assert.equal(n.sha, null);
    assert.equal(n.github, null);
    const s = analyze(repo, { sha: "abcdef1234" });
    assert.equal(s.sha, "abcdef1");
    assert.equal(s.github, null);
    assert.ok(analyze(repo, { github }).github);
  });
});

test("AC6: the repo option names the repo and the unnamed root package", () => {
  tmp((d) => {
    const dir = join(d, "owner-repo-abc123");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
    const f = analyze(dir, { repo: "excalidraw" });
    assert.equal(f.repo, "excalidraw");
    assert.equal(f.packages[0].name, "excalidraw");
    assert.equal(analyze(dir).repo, "owner-repo-abc123");
  });
});

test("AC7: bad overrides throw, naming the field, before any file is read", () => {
  const missing = join(tmpdir(), "cw-nogit-does-not-exist");
  const ok = { repo: "o/r", sha: FULL, dir: "" };
  assert.throws(() => analyze(missing, { sha: "xyz" }), /sha/);
  assert.throws(() => analyze(missing, { sha: "abc" }), /sha/);
  assert.throws(() => analyze(missing, { github: { ...ok, repo: "nope" } }), /github\.repo/);
  assert.throws(() => analyze(missing, { github: { ...ok, sha: "abcdef1" } }), /github\.sha/);
  for (const dir of ["/abs/", "a/../b/", "apps/web", "a\\b/", "./"]) assert.throws(() => analyze(missing, { github: { ...ok, dir } }), /github\.dir/, dir);
  assert.throws(() => analyze(missing, { repo: "  " }), /repo/);
  assert.doesNotThrow(() => { try { analyze(missing, { github: { ...ok, dir: "apps/web/" } }); } catch (e) { if (/invalid/.test(String(e))) throw e; } });
});

test("AC8: the no-git walk skips symlinked files and directories", { skip: process.platform === "win32" }, () => {
  tmp((d) => {
    const copy = copyFixture("basic-app", d);
    const outside = join(d, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
    symlinkSync(join(outside, "secret.ts"), join(copy, "linked.ts"));
    symlinkSync(outside, join(copy, "linkdir"));
    const paths = analyze(copy, { git: "off" }).files.map((f) => f.path);
    assert.ok(paths.length > 0);
    assert.ok(!paths.some((p) => p.includes("secret") || p.includes("linked") || p.includes("linkdir")), paths.join());
  });
});

test("buildFromFiles: a github override supplies the short sha; bad options throw BuildError", async () => {
  const files = { "src/a.ts": "export const a = 1;\n" };
  const r = await buildFromFiles(files, { github: { repo: "o/r", sha: FULL, dir: "" } });
  assert.ok(r.ok);
  assert.equal(r.facts.sha, FULL.slice(0, 7));
  const r2 = await buildFromFiles(files);
  assert.ok(r2.ok);
  assert.equal(r2.facts.sha, null);
  await assert.rejects(buildFromFiles(files, { sha: "xyz" }), (e: Error) => e.name === "BuildError" && /sha/.test(e.message));
});
