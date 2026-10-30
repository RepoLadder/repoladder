import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, extractTexts } from "../scripts/leakhook.ts";

const hook = fileURLToPath(new URL("../scripts/leakhook.ts", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));

// A temp root whose scripts/leakguard.ts rejects any stdin containing SECRETWORD and drops a marker file when run.
function root(guard?: string) {
  const dir = mkdtempSync(join(tmpdir(), "leakhook-"));
  mkdirSync(join(dir, "scripts"));
  if (guard !== "absent") {
    writeFileSync(join(dir, "scripts", "leakguard.ts"), guard ?? `
import { readFileSync, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(dir, "ran"))}, "1");
const t = readFileSync(0, "utf8");
if (t.includes("SECRETWORD")) { console.log("internal term: SECRETWORD"); process.exit(1); }
`);
  }
  return dir;
}
const bash = (command: string, cwd?: string) => ({ tool_name: "Bash", tool_input: { command }, cwd });
const HOME = "/" + "Users"; // built at runtime so this file passes the leak guard
const ran = (dir: string) => existsSync(join(dir, "ran"));

function blocked(dir: string, command: string) {
  const v = decide(bash(command, dir), dir);
  assert.equal(v.code, 2, command);
  assert.match(v.stderr, /Reword it and retry/);
  assert.match(v.stderr, /SECRETWORD/);
}
function allowed(dir: string, command: string) {
  const v = decide(bash(command, dir), dir);
  assert.equal(v.code, 0, `${command}\n${v.stderr}`);
  return v;
}

test("commands that are not a commit or gh post allow without spawning the guard", () => {
  const dir = root();
  for (const c of ["ls", "git status", "git log -m SECRETWORD", "gh pr view 1", "gh pr list --search SECRETWORD", "echo SECRETWORD", "git commit --amend --no-edit"]) allowed(dir, c);
  assert.equal(ran(dir), false);
});

test("git commit message forms", () => {
  const dir = root();
  allowed(dir, 'git commit -m "clean"');
  blocked(dir, 'git commit -m "SECRETWORD"');
  blocked(dir, "git -c user.name=x -C p commit --message=SECRETWORD");
  blocked(dir, "git commit --message SECRETWORD");
  blocked(dir, "git commit -am SECRETWORD");
  blocked(dir, "git commit -mSECRETWORD");
  blocked(dir, "git commit -m a -m SECRETWORD");
  blocked(dir, "git add -A && git commit -m SECRETWORD && git push");
  blocked(dir, "FOO=1 git commit -m SECRETWORD");
});

test("path and repo arguments are never scanned", () => {
  const dir = root();
  allowed(dir, `git -C ${HOME}/x/repo commit -m "clean"`);
  allowed(dir, 'gh pr create -R SECRETWORD/repo --head SECRETWORD --base SECRETWORD --title t --body b');
  assert.equal(ran(dir), true);
});

test("heredoc commit messages, apostrophes included", () => {
  const dir = root();
  const msg = (body: string) => `git commit -m "$(cat <<'EOF'\n${body}\n\nCo-Authored-By: x\nEOF\n)"`;
  blocked(dir, msg("fix don't leak SECRETWORD"));
  allowed(dir, msg("fix don't leak anything"));
});

test("a heredoc that feeds a pipe is still scanned", () => {
  const dir = root();
  blocked(dir, `cat <<'EOF' | gh pr create --title t --body-file -\nSECRETWORD\nEOF`);
  blocked(dir, `cat <<'EOF' | git commit -F -\nSECRETWORD\nEOF`);
  allowed(dir, `cat <<'EOF' | git commit -F -\nfine\nEOF`);
});

test("-F files: dirty blocks, clean allows, missing allows with a warning", () => {
  const dir = root();
  writeFileSync(join(dir, "dirty.txt"), "SECRETWORD");
  writeFileSync(join(dir, "clean.txt"), "fine");
  blocked(dir, "git commit -F dirty.txt");
  allowed(dir, "git commit -F clean.txt");
  assert.match(allowed(dir, "git commit -F missing.txt").stderr, /could not read missing\.txt/);
});

test("gh issue and pr text", () => {
  const dir = root();
  writeFileSync(join(dir, "dirty.md"), "SECRETWORD");
  writeFileSync(join(dir, "clean.md"), "fine");
  const base = "gh pr create -R o/r --draft --base develop --head b --title t";
  blocked(dir, `${base} --body-file dirty.md`);
  allowed(dir, `${base} --body-file clean.md`);
  assert.match(allowed(dir, `${base} --body-file gone.md`).stderr, /could not read gone\.md/);
  blocked(dir, `${base} --body "x SECRETWORD"`);
  blocked(dir, `${base} --body="x SECRETWORD"`);
  blocked(dir, 'gh pr create -t "SECRETWORD" -b ok');
  blocked(dir, 'gh pr create -t ok -b "SECRETWORD"');
  blocked(dir, 'gh issue create --title SECRETWORD --body ok');
  blocked(dir, "gh issue comment 1 --body SECRETWORD");
  blocked(dir, "gh pr edit 1 --body-file dirty.md");
  blocked(dir, "gh pr comment 1 --body SECRETWORD");
  blocked(dir, `gh pr create --body-file - <<'EOF'\nSECRETWORD\nEOF`);
  allowed(dir, `gh pr create --body-file - <<'EOF'\nfine\nEOF`);
  allowed(dir, "gh pr view 1 --comments");
});

test("fails open", () => {
  const absent = root("absent");
  const v = allowed(absent, "git commit -m SECRETWORD");
  assert.match(v.stderr, /not found/);
  const crash = root("process.kill(process.pid, 'SIGKILL');");
  assert.match(allowed(crash, "git commit -m SECRETWORD").stderr, /did not finish/);
  const syntax = root("const x = ;");
  assert.match(allowed(syntax, "git commit -m fine").stderr, /guard failed/);
  const exit2 = root("process.exit(2);");
  assert.match(allowed(exit2, "git commit -m SECRETWORD").stderr, /guard failed/);
  assert.equal(decide({}, absent).code, 0);
  assert.equal(decide({ tool_name: "Bash" }, absent).code, 0);
  assert.equal(decide({ tool_name: "Read", tool_input: { command: "git commit -m SECRETWORD" } }, absent).code, 0);
  assert.equal(extractTexts("git commit -m '", "/")?.kinds.size, 1);
});

test("the CLI reads stdin and exits 2 or 0", () => {
  const dir = root();
  const run = (input: string) => spawnSync(process.execPath, [hook], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" });
  const bad = run(JSON.stringify(bash('git commit -m "SECRETWORD"', dir)));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^leak guard blocked this commit message\. Reword it and retry; do not work around the check\.\n\ninternal term: SECRETWORD/);
  assert.equal(run(JSON.stringify(bash('git commit -m "fine"', dir))).status, 0);
  assert.equal(run("not json").status, 0);
});

test("the real guard rejects a home path through the hook", () => {
  if (!existsSync(join(repo, "scripts", "leakguard.ts"))) return;
  assert.equal(decide(bash(`git commit -m "see ${HOME}/someone/x"`, repo), repo).code, 2);
  assert.equal(decide(bash(`git -C ${HOME}/someone/x commit -m "fine"`, repo), repo).code, 0);
});

test(".claude/settings.json wires the hook", () => {
  const s = JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"));
  const entry = s.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash");
  assert.match(entry.hooks[0].command, /scripts\/leakhook\.ts/);
  assert.equal(existsSync(join(repo, "scripts", "leakhook.ts")), true);
});

test("a shell comment with an apostrophe does not hide a later commit; subshell and env wrappers are scanned", () => {
  const cwd = process.cwd();
  for (const cmd of ["# don't forget\ngit commit -m 'SECRETWORD'", "git add . # it's fine\ngit commit -m SECRETWORD", "(git commit -m SECRETWORD)", "env GIT_X=1 git commit -m SECRETWORD"]) {
    assert.deepEqual(extractTexts(cmd, cwd)?.texts, ["SECRETWORD"], cmd);
  }
});
