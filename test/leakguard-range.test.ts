// Range scans (--diff / --pre-push) skip lines already on origin/develop or origin/main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { integrationBase, parseOptions, rangeTip, run, type ConfigJson, type Deps } from "../scripts/leakguard.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "scripts/leakguard.config.json"), "utf8")) as ConfigJson;
const APP = ["front", "desk"].join("");
const HOME = ["/Us", "ers/"].join("");
const realPath = `${HOME}${["jo", "hndoe"].join("")}/src`;
const o = (...argv: string[]) => parseOptions(argv);

const diffOf = (file: string, ...lines: string[]) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...lines.map((l) => `+${l}`)].join("\n");

// mocked git: the remote-range diff and the merge-base diff are given separately
function mock(opts: { range: string; fromBase: string; base?: string; throwSecond?: boolean; stdin?: string }) {
  const out: string[] = [];
  const leaks: string[][] = [];
  const base = opts.base ?? "b4s3";
  const deps: Deps = {
    git: (args) => {
      if (args[0] === "merge-base") {
        if (!base) throw new Error("none");
        return base + "\n";
      }
      const r = args.at(-1) as string;
      if (args.includes("diff")) {
        if (r.startsWith(`${base}..`)) {
          if (opts.throwSecond) throw new Error("boom");
          return opts.fromBase;
        }
        return opts.range;
      }
      return "";
    },
    gitleaks: (a) => (leaks.push(a), 0),
    readFile: () => null,
    fileSize: () => 1,
    readStdin: () => opts.stdin ?? "",
    config,
    readPrivate: () => null,
    readLocal: () => ({}),
    writePrivate: () => {},
    out: (s) => out.push(s),
    err: () => {},
  };
  return { deps, out, leaks };
}

const hit = diffOf("ci.yml", `see the ${APP} app`);
const logOpts = (m: ReturnType<typeof mock>) => m.leaks[0].find((a) => a.startsWith("--log-opts="));

test("a hit that is also on the integration branch is not rescanned", () => {
  const m = mock({ range: hit, fromBase: "" });
  assert.equal(run(o("--diff", "r1..tip", "--gitleaks"), m.deps), 0);
  assert.equal(logOpts(m), "--log-opts=r1..tip ^origin/develop");
});

test("a hit the branch adds still fails with file:line: [rule] why", () => {
  const m = mock({ range: hit, fromBase: hit });
  assert.equal(run(o("--diff", "r1..tip", "--no-gitleaks"), m.deps), 1);
  assert.deepEqual(m.out, ["ci.yml:1: [private-app] internal app name"]);
});

test("--strict does not narrow", () => {
  const m = mock({ range: hit, fromBase: "" });
  assert.equal(run(o("--diff", "r1..tip", "--strict", "--gitleaks"), m.deps), 1);
  assert.equal(logOpts(m), "--log-opts=r1..tip");
});

test("a failing second diff keeps the scan unfiltered", () => {
  const m = mock({ range: hit, fromBase: "", throwSecond: true });
  assert.equal(run(o("--diff", "r1..tip", "--gitleaks"), m.deps), 1);
  assert.equal(logOpts(m), "--log-opts=r1..tip");
});

test("with no merge-base the scan is unnarrowed", () => {
  const m = mock({ range: hit, fromBase: "", base: "" });
  assert.equal(run(o("--diff", "r1..tip", "--gitleaks"), m.deps), 1);
  assert.equal(logOpts(m), "--log-opts=r1..tip");
});

test("pre-push narrows the same way", () => {
  const stdin = "refs/heads/f aaa refs/heads/f bbb\n";
  const m = mock({ range: hit, fromBase: "", stdin });
  assert.equal(run(o("--pre-push", "--gitleaks"), m.deps), 0);
  assert.equal(logOpts(m), "--log-opts=bbb..aaa ^origin/develop");
});

test("rangeTip", () => {
  assert.equal(rangeTip("a..b"), "b");
  assert.equal(rangeTip("a...b"), "b");
  assert.equal(rangeTip("a.."), null);
  assert.equal(rangeTip("HEAD~2"), null);
  assert.equal(rangeTip("x/y..z"), "z");
});

test("integrationBase falls through from origin/develop to origin/main", () => {
  const seen: string[] = [];
  const git = (a: string[]) => {
    seen.push(a[2]);
    if (a[2] === "origin/develop") throw new Error("no");
    return "abc\n";
  };
  assert.deepEqual(integrationBase("tip", git), { ref: "origin/main", sha: "abc" });
  assert.deepEqual(seen, ["origin/develop", "origin/main"]);
  assert.equal(integrationBase("tip", () => { throw new Error("no"); }), null);
});

const hasGit = spawnSync("git", ["--version"]).status === 0;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const push = (cwd: string, ...args: string[]) => spawnSync("git", ["push", ...args], { cwd, encoding: "utf8" });

test("pre-push hook: develop merges pass, branch and merge-resolution leaks fail", { skip: !hasGit && "git missing" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "leakguard-range-"));
  try {
    const repo = join(tmp, "repo");
    const bare = join(tmp, "remote.git");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(join(repo, ".githooks"));
    sh(tmp, "init", "--bare", "-q", bare);
    sh(tmp, "init", "-q", "-b", "develop", repo);
    for (const f of ["scripts/leakguard.ts", "scripts/leakguard.config.json", "scripts/githooks.ts", ".githooks/pre-push"]) copyFileSync(join(root, f), join(repo, f));
    chmodSync(join(repo, ".githooks/pre-push"), 0o755);
    writeFileSync(join(repo, "scripts/leakguard.private.json"), JSON.stringify({ allowlist: [], baseline: { "private-app:doc.md": 1 } }));
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) sh(repo, "config", k, v);
    sh(repo, "remote", "add", "origin", bare);
    writeFileSync(join(repo, "doc.md"), `the ${APP} app\n`);
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "init");
    const env = { ...process.env, CI: "" };
    assert.equal(spawnSync("node", ["scripts/githooks.ts"], { cwd: repo, env }).status, 0);
    assert.equal(push(repo, "-u", "origin", "develop").status, 0, "baselined tree scan passes");
    const commit = (file: string, text: string, msg: string) => {
      writeFileSync(join(repo, file), text);
      sh(repo, "add", "-A");
      sh(repo, "commit", "-qm", msg);
    };
    const advance = (file: string, text: string) => {
      sh(repo, "checkout", "-q", "develop");
      commit(file, text, "develop");
      assert.equal(push(repo, "--no-verify", "origin", "develop").status, 0);
      sh(repo, "checkout", "-q", "feature");
    };

    sh(repo, "checkout", "-q", "-b", "feature");
    commit("f.txt", "clean\n", "feature");
    assert.equal(push(repo, "-u", "origin", "feature").status, 0, "clean branch push");

    // AC1: a develop merge carrying a baselined hit
    advance("doc.md", `the ${APP} app\nthe ${APP} app again\n`);
    sh(repo, "merge", "-q", "--no-edit", "develop");
    assert.equal(push(repo, "origin", "feature").status, 0, "develop merge passes");

    // AC2: a leak in a branch commit
    commit("leak.txt", `path ${realPath}\n`, "leak");
    const bad = push(repo, "origin", "feature");
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /leak\.txt:1: \[user-path\]/);
    assert.ok(!bad.stderr.includes("johndoe"));
    sh(repo, "reset", "-q", "--hard", "HEAD~1");

    // AC3: a leak only in the merge commit's own resolution
    advance("g.txt", "clean\n");
    sh(repo, "merge", "-q", "--no-commit", "--no-ff", "develop");
    writeFileSync(join(repo, "evil.txt"), `path ${realPath}\n`);
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "evil merge");
    const evil = push(repo, "origin", "feature");
    assert.notEqual(evil.status, 0);
    assert.match(evil.stderr, /evil\.txt:1:/);
    sh(repo, "reset", "-q", "--hard", "HEAD~1");

    // AC4: new branches and deletes
    sh(repo, "checkout", "-q", "-b", "fresh");
    commit("h.txt", "clean\n", "fresh");
    assert.equal(push(repo, "-u", "origin", "fresh").status, 0);
    sh(repo, "checkout", "-q", "-b", "fresh2");
    commit("leak2.txt", `path ${realPath}\n`, "leak");
    assert.notEqual(push(repo, "-u", "origin", "fresh2").status, 0);
    assert.equal(push(repo, "origin", "--delete", "fresh").status, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
