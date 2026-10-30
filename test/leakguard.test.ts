// The leak guard (#414). Anything that needs a real term or token shape is built from parts at runtime,
// so this file passes its own scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAllowlist, applyBaseline, formatFinding, imageReport, isAllowlisted, loadRules, parseAddedLines, parseOptions,
  pushRanges, run, scanPath, scanText, type ConfigJson, type Deps, type PrivateJson,
} from "../scripts/leakguard.ts";
import { install } from "../scripts/githooks.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "scripts/leakguard.config.json"), "utf8")) as ConfigJson;
const rules = loadRules(config);
const APP = ["front", "desk"].join("");
const ORG = ["evan", "ossege"].join("");
const OLD = ["code", "wehb"].join("");
const SLUG = ["qtweh", "by/", OLD].join("");
const HOME = ["/Us", "ers/"].join("");
const realPath = `${HOME}${["jo", "hndoe"].join("")}/src`;
const hits = (text: string) => scanText("f.ts", text, rules).map((f) => f.rule);

test("each rule flags its example and passes a near-miss", () => {
  const cases: [string, string, string][] = [
    ["private-app", `see the ${APP} app`, "see the front end"],
    ["private-owner-org", `${ORG.toUpperCase()} LLC`, "evan and ossege"],
    ["private-repo", `git clone ${SLUG}`, ["qtweh", "by/other-repo"].join("")],
    ["user-path", `cd ${realPath}`, "cd /Users/<name>/src"],
    ["user-path", `ls ${["/ho", "me/"].join("")}alice/x`, "ls /homes/alice/x"],
    ["secret-private-key", ["-----BEGIN RSA ", "PRIVATE KEY-----"].join(""), "-----BEGIN PUBLIC KEY-----"],
    ["secret-aws-key", ["AK", "IA", "ABCDEFGHIJKLMNOP"].join(""), "AKIA short"],
    ["secret-github-token", ["gh", "p_", "a".repeat(36)].join(""), ["gh", "p_short"].join("")],
    ["secret-slack-token", ["xo", "xb-", "1234567890-abcdef"].join(""), "xoxb- nothing"],
    ["secret-anthropic-key", ["sk-", "ant-", "api03-", "a".repeat(30)].join(""), "sk-ant-"],
    ["secret-assignment", `const apiKey = "${"k".repeat(24)}"`, 'const apiKey = "short"'],
  ];
  for (const [rule, bad, ok] of cases) {
    assert.ok(hits(bad).includes(rule), `${rule} flags: ${rule}`);
    assert.ok(!hits(ok).includes(rule), `${rule} passes its near-miss`);
  }
});

test("output never contains the matched text", () => {
  const found = scanText("a.md", `${APP} at ${realPath}\n${SLUG}`, rules);
  assert.ok(found.length >= 3);
  const out = found.map(formatFinding).join("\n");
  for (const secret of [APP, "johndoe", SLUG]) assert.ok(!out.toLowerCase().includes(secret.toLowerCase()), secret);
  assert.match(formatFinding(found[0]), /^a\.md:1: \[[a-z-]+\] .+$/);
});

test("placeholder home paths are not findings (usage.test.ts fixtures)", () => {
  assert.deepEqual(hits(`path: "${HOME}me/src"`), []);
  assert.deepEqual(hits(`${HOME}me/x.ts and /home/runner/work`), []);
  assert.deepEqual(hits(`cd ${HOME}<you>/code`), []);
  assert.deepEqual(hits(realPath), ["user-path"]);
});

test("a file name that matches a rule is a line 0 finding", () => {
  assert.deepEqual(scanPath(`docs/${APP}-notes.md`, rules).map((f) => [f.line, f.rule]), [[0, "private-app"]]);
  assert.deepEqual(scanPath("docs/notes.md", rules), []);
});

test("local owner terms merge in; a malformed local value is ignored", () => {
  const withLocal = loadRules(config, { terms: ["Moonbase", "  ", 7] });
  assert.ok(scanText("f", "the MOONBASE plan", withLocal).some((f) => f.rule === "local-term"));
  assert.deepEqual(scanText("f", "the MOONBASE plan", rules), []);
  for (const bad of [null, "x", { terms: "no" }, []]) assert.equal(loadRules(config, bad).length, rules.length);
});

test("allowlist: exact path, directory and glob", () => {
  const list = ["internal/", "docs/plan.md", "docs/notes*", "scripts/tool*.ts"];
  assert.ok(isAllowlisted("internal/a/b.json", list));
  assert.ok(isAllowlisted("docs/plan.md", list));
  assert.ok(isAllowlisted("docs/notes.md", list));
  assert.ok(isAllowlisted("docs/notes/board.png", list));
  assert.ok(isAllowlisted("scripts/toolsite.ts", list));
  assert.ok(!isAllowlisted("docs/plan.mdx", list));
  assert.ok(!isAllowlisted("src/internal/x.ts", list));
  const f = { file: "internal/x", line: 1, rule: "r", why: "w" };
  assert.deepEqual(applyAllowlist([f, { ...f, file: "src/x.ts" }], list).map((x) => x.file), ["src/x.ts"]);
});

test("baseline ratchet: equal passes, higher fails, lower notes the shrink, unknown fails", () => {
  const f = (file: string, line: number) => ({ file, line, rule: "private-app", why: "w" });
  const base = { "private-app:a.ts": 2, "private-app:gone.ts": 1 };
  const equal = applyBaseline([f("a.ts", 1), f("a.ts", 9)], base);
  assert.deepEqual(equal.findings, []);
  assert.deepEqual(equal.shrink, ["private-app:gone.ts"]);
  assert.equal(applyBaseline([f("a.ts", 1), f("a.ts", 2), f("a.ts", 3)], base).findings.length, 3);
  assert.deepEqual(applyBaseline([f("a.ts", 1)], base).shrink.sort(), ["private-app:a.ts", "private-app:gone.ts"]);
  assert.equal(applyBaseline([f("new.ts", 1)], base).findings.length, 1);
});

test("parseAddedLines reads files and line numbers; context and removed lines are ignored", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,3 @@", "-old", "+new one", "+new two", " ctx",
    "@@ -10 +12 @@", "+later",
    "diff --git a/b.md b/b.md", "--- /dev/null", "+++ b/b.md", "@@ -0,0 +1 @@", "+first",
    "diff --git a/c.md b/c.md", "--- a/c.md", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone",
  ].join("\n");
  assert.deepEqual(parseAddedLines(diff), [
    { file: "a.ts", line: 1, text: "new one" }, { file: "a.ts", line: 2, text: "new two" },
    { file: "a.ts", line: 12, text: "later" }, { file: "b.md", line: 1, text: "first" },
  ]);
});

test("pushRanges: new ref, existing ref, delete", () => {
  const zero = "0".repeat(40);
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === "merge-base") return args[2] === "origin/develop" ? "base1\n" : "";
    return "";
  };
  const stdin = [`refs/heads/new aaa1 refs/heads/new ${zero}`, `refs/heads/old bbb2 refs/heads/old ccc3`, `refs/heads/del ${zero} refs/heads/del ddd4`].join("\n");
  assert.deepEqual(pushRanges(stdin, git), [
    { ref: "refs/heads/new", range: "base1..aaa1" },
    { ref: "refs/heads/old", range: "ccc3..bbb2" },
  ]);
  const none = () => {
    throw new Error("no git");
  };
  assert.deepEqual(pushRanges(`refs/heads/new aaa1 refs/heads/new ${zero}`, none), [{ ref: "refs/heads/new", range: null }]);
  assert.deepEqual(pushRanges("", none), []);
});

test("parseOptions", () => {
  assert.equal(parseOptions([]).mode, "tree");
  assert.deepEqual(parseOptions(["--diff", "a..b", "--strict"]), { ...parseOptions([]), mode: "diff", range: "a..b", strict: true });
  assert.equal(parseOptions(["--pre-push", "origin", "git@example:x"]).mode, "pre-push");
  assert.deepEqual([parseOptions(["--file", "x.md"]).mode, parseOptions(["--file", "x.md"]).file], ["text", "x.md"]);
  assert.equal(parseOptions(["--text"]).mode, "text");
  assert.throws(() => parseOptions(["--nope"]));
  assert.throws(() => parseOptions(["--diff"]));
});

test("imageReport counts tracked images outside plugin/dist with their sizes", () => {
  const r = imageReport(["a.png", "docs/b.JPG", "plugin/dist/c.png", "d.ts"], () => 1000);
  assert.deepEqual(r, { count: 2, bytes: 2000, dirs: { "./": 1, "docs/": 1 } });
});

// A run() harness with an in-memory tree and no process, git or gitleaks.
function harness(files: Record<string, string>, opts: { priv?: PrivateJson | null; gitleaks?: Deps["gitleaks"]; stdin?: string; local?: ReturnType<Deps["readLocal"]> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let privReads = 0;
  const deps: Deps = {
    git: (args) => (args[0] === "ls-files" ? Object.keys(files).join("\0") + "\0" : ""),
    gitleaks: opts.gitleaks ?? (() => null),
    readFile: (p) => files[p] ?? null,
    fileSize: () => 10,
    readStdin: () => opts.stdin ?? "",
    config,
    readPrivate: () => {
      privReads++;
      return opts.priv ?? null;
    },
    readLocal: () => opts.local ?? {},
    writePrivate: () => {},
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  return { deps, out, err, privReads: () => privReads };
}
const o = (...argv: string[]) => parseOptions(argv);

test("tree mode: a clean tree exits 0, a leak exits 1 with file:line: [rule] why", () => {
  const clean = harness({ "a.ts": "const x = 1;\n" });
  assert.equal(run(o("--no-gitleaks"), clean.deps), 0);
  const dirty = harness({ "a.ts": `ok\n// ${realPath}\n` });
  assert.equal(run(o("--no-gitleaks"), dirty.deps), 1);
  assert.deepEqual(dirty.out, ["a.ts:2: [user-path] absolute home-directory path"]);
});

test("tree mode: allowlisted paths pass, and --strict fails them without reading the private file", () => {
  const files = { "internal/a.json": APP, "src/x.ts": "fine" };
  const priv = { allowlist: ["internal/"], baseline: {} };
  assert.equal(run(o("--no-gitleaks"), harness(files, { priv }).deps), 0);
  const strict = harness(files, { priv });
  assert.equal(run(o("--strict", "--no-gitleaks"), strict.deps), 1);
  assert.equal(strict.privReads(), 0);
});

test("tree mode: the baseline lets known hits pass and blocks more", () => {
  const priv = { allowlist: [], baseline: { "private-app:a.md": 1 } };
  assert.equal(run(o("--no-gitleaks"), harness({ "a.md": APP }, { priv }).deps), 0);
  assert.equal(run(o("--no-gitleaks"), harness({ "a.md": `${APP}\n${APP}` }, { priv }).deps), 1);
  const shrunk = harness({ "a.md": "clean" }, { priv });
  assert.equal(run(o("--no-gitleaks"), shrunk.deps), 0);
  assert.ok(shrunk.err.some((l) => /baseline can shrink/.test(l)));
});

test("text mode (stdin and --file) uses the rules only and reports <stdin>:line", () => {
  const priv = { allowlist: ["<stdin>"], baseline: { "private-app:<stdin>": 5 } };
  const h = harness({}, { priv, stdin: `fine\nabout ${APP}\n` });
  assert.equal(run(o("--text"), h.deps), 1);
  assert.deepEqual(h.out, ["<stdin>:2: [private-app] internal app name"]);
  assert.equal(h.privReads(), 0);
  const f = harness({ "draft.md": `${ORG}` });
  assert.equal(run(o("--file", "draft.md"), f.deps), 1);
  assert.deepEqual(f.out, ["draft.md:1: [private-owner-org] internal organisation name"]);
  assert.equal(run(o("--text"), harness({}, { stdin: "all good" }).deps), 0);
});

test("--dry-run always exits 0 and --json prints valid JSON of the findings", () => {
  const h = harness({ "a.md": APP });
  assert.equal(run(o("--strict", "--dry-run", "--json"), h.deps), 0);
  const parsed = JSON.parse(h.out.join("\n"));
  assert.deepEqual(parsed.findings, [{ file: "a.md", line: 1, rule: "private-app", why: "internal app name" }]);
  assert.equal(parsed.images.count, 0);
  assert.equal(parsed.gitleaks, "skipped");
});

test("local file: merged terms apply, and a malformed file only warns", () => {
  const files = { "a.md": "the moonbase" };
  assert.equal(run(o("--no-gitleaks"), harness(files, { local: { value: { terms: ["moonbase"] } } }).deps), 1);
  const warned = harness(files, { local: { warning: "x is not valid JSON" } });
  assert.equal(run(o("--no-gitleaks"), warned.deps), 0);
  assert.ok(warned.err.some((l) => /not valid JSON/.test(l)));
});

test("pre-push with no base to diff against scans the tree through the baseline", () => {
  const stdin = `refs/heads/x aaa1 refs/heads/x ${"0".repeat(40)}\n`;
  const priv = { allowlist: [], baseline: { "private-app:a.md": 1 } };
  assert.equal(run(o("--pre-push", "--no-gitleaks"), harness({ "a.md": APP }, { priv, stdin }).deps), 0);
  assert.equal(run(o("--pre-push", "--no-gitleaks"), harness({ "a.md": `${APP}\n${APP}` }, { priv, stdin }).deps), 1);
});

test("tree mode reports tracked images without failing", () => {
  const h = harness({ "docs/a.png": "", "src/x.ts": "ok" });
  assert.equal(run(o("--no-gitleaks"), h.deps), 0);
  assert.ok(h.err.some((l) => /1 images .* cannot be text-scanned/.test(l)));
});

test("gitleaks: absent warns, absent with --require-gitleaks fails, a nonzero runner fails", () => {
  const files = { "a.ts": "ok" };
  const absent = harness(files);
  assert.equal(run(o(), absent.deps), 0);
  assert.ok(absent.err.some((l) => /gitleaks not installed/.test(l)));
  assert.equal(run(o("--require-gitleaks"), harness(files).deps), 1);
  assert.equal(run(o(), harness(files, { gitleaks: () => 1 }).deps), 1);
  assert.equal(run(o("--dry-run"), harness(files, { gitleaks: () => 1 }).deps), 0);
  const seen: string[][] = [];
  assert.equal(run(o(), harness(files, { gitleaks: (a) => (seen.push(a), 0) }).deps), 0);
  assert.deepEqual(seen[0].slice(0, 2), ["dir", "."]);
  assert.ok(seen[0].includes("--redact"));
  let ran = false;
  run(o("--strict"), harness(files, { gitleaks: () => ((ran = true), 0) }).deps);
  assert.equal(ran, false, "strict runs gitleaks only on request");
});

test("shipped config: no literal private-app or old-name term, and no reference to a dropped path", () => {
  const text = readFileSync(join(root, "scripts/leakguard.config.json"), "utf8").toLowerCase();
  for (const term of [APP, ORG, OLD, SLUG, "leakguard.private"]) assert.ok(!text.includes(term), term);
  const script = readFileSync(join(root, "scripts/leakguard.ts"), "utf8").toLowerCase();
  for (const term of [APP, ORG, OLD]) assert.ok(!script.includes(term), term);
  assert.deepEqual(rules.filter((r) => ["private-app", "private-owner-org", "private-repo"].includes(r.id)).map((r) => r.re.test(APP)), [true, false, false]);
});

test("the shipped private file is public-safe: counts only, no private text", () => {
  const p = JSON.parse(readFileSync(join(root, "scripts/leakguard.private.json"), "utf8")) as PrivateJson;
  assert.ok(p.allowlist?.includes("scripts/leakguard.private.json"));
  for (const n of Object.values(p.baseline ?? {})) assert.equal(typeof n, "number");
  assert.ok(Object.keys(p.baseline ?? {}).every((k) => /^[a-z-]+:[^\s]+$/.test(k)));
});

test(".gitleaks.toml extends the default rules", () => {
  assert.match(readFileSync(join(root, ".gitleaks.toml"), "utf8"), /useDefault\s*=\s*true/);
});

test("githooks install: no-op under CI and outside a work tree, never throws", () => {
  const git = (args: string[]) => (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree" ? "true\n" : "/repo\n");
  assert.equal(install({ CI: "1" }, git, () => true), "skipped: CI");
  assert.match(install({}, () => "false\n", () => true), /not a work tree/);
  assert.match(install({}, () => { throw new Error("no git"); }, () => true), /git unavailable/);
  assert.match(install({}, git, () => false), /no pre-push hook/);
  const set: string[][] = [];
  assert.equal(install({}, (a) => (set.push(a), git(a)), () => true), "installed");
  assert.deepEqual(set.at(-1), ["config", "core.hooksPath", ".githooks"]);
});

// Hook integration: a temp repo with the guard copied in, pushing to a local bare remote.
const hasGit = spawnSync("git", ["--version"]).status === 0;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const push = (cwd: string, ...args: string[]) => spawnSync("git", ["push", ...args], { cwd, encoding: "utf8" });

test("pre-push hook blocks a leak and allows a clean push, in a repo and in its worktree", { skip: !hasGit && "git missing" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "leakguard-"));
  try {
    const repo = join(tmp, "repo");
    const bare = join(tmp, "remote.git");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(join(repo, ".githooks"));
    sh(tmp, "init", "--bare", "-q", bare);
    sh(tmp, "init", "-q", "-b", "main", repo);
    for (const f of ["scripts/leakguard.ts", "scripts/leakguard.config.json", "scripts/githooks.ts", ".githooks/pre-push"]) copyFileSync(join(root, f), join(repo, f));
    chmodSync(join(repo, ".githooks/pre-push"), 0o755);
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) sh(repo, "config", k, v);
    sh(repo, "remote", "add", "origin", bare);
    writeFileSync(join(repo, "a.txt"), "hello\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "init");

    const env = { ...process.env, CI: "" };
    assert.equal(spawnSync("node", ["scripts/githooks.ts"], { cwd: repo, env }).status, 0);
    assert.equal(sh(repo, "config", "core.hooksPath").trim(), ".githooks");
    assert.equal(push(repo, "-u", "origin", "main").status, 0, "clean first push (new ref, whole tree)");

    const wt = join(tmp, "wt");
    sh(repo, "worktree", "add", "-q", "-b", "feature", wt);
    assert.equal(sh(wt, "config", "core.hooksPath").trim(), ".githooks");
    assert.ok(existsSync(join(wt, ".githooks/pre-push")));

    for (const dir of [repo, wt]) {
      const branch = dir === repo ? "main" : "feature";
      writeFileSync(join(dir, "leak.txt"), `path ${realPath}\n`);
      sh(dir, "add", "-A");
      sh(dir, "commit", "-qm", "leak");
      const bad = push(dir, "origin", branch);
      assert.notEqual(bad.status, 0, `${branch}: leak blocked`);
      assert.match(bad.stderr, /leak\.txt:1: \[user-path\]/);
      assert.ok(!bad.stderr.includes("johndoe"));
      sh(dir, "reset", "-q", "--hard", "HEAD~1");
      writeFileSync(join(dir, "ok.txt"), "fine\n");
      sh(dir, "add", "-A");
      sh(dir, "commit", "-qm", "ok");
      assert.equal(push(dir, "origin", branch).status, 0, `${branch}: clean push allowed`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("githooks.ts exits 0 outside a git repo and under CI", { skip: !hasGit && "git missing" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "leakguard-nogit-"));
  try {
    const script = join(root, "scripts/githooks.ts");
    const env = { ...process.env, CI: "", GIT_CEILING_DIRECTORIES: tmpdir() };
    assert.equal(spawnSync("node", [script], { cwd: tmp, env }).status, 0);
    assert.equal(spawnSync("node", [script], { cwd: root, env: { ...env, CI: "1" } }).status, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
