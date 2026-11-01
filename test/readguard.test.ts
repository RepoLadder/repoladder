import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { decide, hookOutput, runGuard } from "../src/serve/readguard.ts";

const base = mkdtempSync(join(tmpdir(), "rl-guard-"));
const repo = join(base, "repo");
const outside = join(base, "outside");
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(repo, "src", "a.ts"), "export {};\n");
writeFileSync(join(outside, "note.txt"), "x");
symlinkSync(outside, join(repo, "link-out"));
symlinkSync(join(repo, "src"), join(repo, "link-in"));
const call = (tool_name: string, tool_input: Record<string, unknown>) => ({ tool_name, tool_input });
const allowed = (c: unknown) => decide(c, repo).allow;

test("Read: inside the repo is allowed, anywhere else is refused", () => {
  assert.ok(allowed(call("Read", { file_path: join(repo, "src", "a.ts") })));
  assert.ok(allowed(call("Read", { file_path: "src/a.ts" })));
  assert.ok(allowed(call("Read", { file_path: join(repo, "src", "not-yet.ts") })));
  assert.ok(allowed(call("Read", { file_path: join(repo, "link-in", "a.ts") })));
  for (const f of [join(outside, "note.txt"), "../outside/note.txt", "/etc/hosts", "~/.zshrc", join(repo, "..", "outside", "note.txt"), join(repo, "src", "..", "..", "outside", "note.txt")]) {
    assert.equal(allowed(call("Read", { file_path: f })), false, f);
  }
});

test("Read: a symlink in the repo that points outside is refused", () => {
  assert.equal(allowed(call("Read", { file_path: join(repo, "link-out", "note.txt") })), false);
});

test("Read: a sibling directory that only shares the repo's name prefix is outside", () => {
  mkdirSync(join(base, "repo-other"), { recursive: true });
  assert.equal(allowed(call("Read", { file_path: join(base, "repo-other", "x.ts") })), false);
});

test("Grep and Glob: path and pattern must stay in the repo", () => {
  assert.ok(allowed(call("Grep", { pattern: "stripe" })));
  assert.ok(allowed(call("Grep", { pattern: "stripe", path: "src", glob: "**/*.ts" })));
  assert.ok(allowed(call("Glob", { pattern: "**/*.ts" })));
  assert.ok(allowed(call("Glob", { pattern: join(repo, "src", "*.ts") })));
  assert.ok(allowed(call("Glob", { pattern: "*.ts", path: join(repo, "src") })));
  assert.equal(allowed(call("Grep", { pattern: "x", path: outside })), false);
  assert.equal(allowed(call("Grep", { pattern: "x", path: ".." })), false);
  assert.equal(allowed(call("Grep", { pattern: "x", path: "~" })), false);
  assert.equal(allowed(call("Grep", { pattern: "x", glob: "../**/*.txt" })), false);
  assert.equal(allowed(call("Glob", { pattern: "/etc/*" })), false);
  assert.equal(allowed(call("Glob", { pattern: "../outside/*" })), false);
  assert.equal(allowed(call("Glob", { pattern: "src/../../outside/*" })), false);
  assert.equal(allowed(call("Glob", { pattern: `${homedir()}/*` })), false);
  assert.equal(allowed(call("Glob", { pattern: "~/*" })), false);
  assert.equal(allowed(call("Glob", { pattern: "*", path: join(repo, "link-out") })), false);
});

test("anything that cannot be read is refused, and other tools are not judged", () => {
  assert.equal(decide(null, repo).allow, false);
  assert.equal(decide({ tool_name: "Read" }, repo).allow, false);
  assert.equal(decide({ tool_name: "Read", tool_input: {} }, repo).allow, false);
  assert.equal(decide({ tool_name: "Read", tool_input: { file_path: 7 } }, repo).allow, false);
  assert.equal(runGuard("not json", repo).includes('"deny"'), true);
  assert.ok(allowed(call("Bash", { command: "ls /etc" })));
});

test("hook output: a deny names the reason, an allow prints nothing", () => {
  const out = JSON.parse(runGuard(JSON.stringify(call("Read", { file_path: "/etc/hosts" })), repo));
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside/);
  assert.equal(runGuard(JSON.stringify(call("Read", { file_path: "src/a.ts" })), repo), "");
  assert.equal(hookOutput({ allow: true }), "");
});

test("repoladder readguard <root> works as a hook command", () => {
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  const run = (input: unknown) => spawnSync(process.execPath, [cli, "readguard", repo], { input: JSON.stringify(input), encoding: "utf8" });
  const no = run(call("Read", { file_path: join(outside, "note.txt") }));
  assert.equal(no.status, 0);
  assert.equal(JSON.parse(no.stdout).hookSpecificOutput.permissionDecision, "deny");
  const yes = run(call("Read", { file_path: join(repo, "src", "a.ts") }));
  assert.equal(yes.status, 0);
  assert.equal(yes.stdout, "");
});

test.after(() => rmSync(base, { recursive: true, force: true }));
