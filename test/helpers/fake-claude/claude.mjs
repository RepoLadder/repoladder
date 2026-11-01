#!/usr/bin/env node
// A fake `claude` for the Ask tests. Logs what it was given to FAKE_CLAUDE_LOG, then behaves per FAKE_CLAUDE_MODE.
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.env.FAKE_CLAUDE_MODE || "ok";
const argv = process.argv.slice(2);
const log = (extra = {}) => process.env.FAKE_CLAUDE_LOG && appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd(), envKeys: Object.keys(process.env), env: process.env, pid: process.pid, ...extra }) + "\n");
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (argv[0] === "--version") {
  console.log(mode === "version" ? "9.9.9 (Claude Code)" : "2.1.316 (Claude Code)");
  process.exit(0);
}
log();
const delta = (text) => emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
if (mode === "signedout") { console.error("Not logged in. Please run /login"); process.exit(1); }
if (mode === "oldcli") { console.error("error: unknown option '--include-partial-messages'"); process.exit(1); }
if (mode === "ratelimit") { console.error("API Error: 429 rate limit reached"); process.exit(1); }
if (mode === "grandchild") {
  const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  log({ childPid: kid.pid });
  setInterval(() => {}, 1000);
} else if (mode === "slow") setInterval(() => {}, 1000);
else if (mode === "manytools") {
  if (process.env.FAKE_CLAUDE_KID) log({ childPid: spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid });
  emit({ type: "system", subtype: "init" });
  for (let i = 0; i < 40; i++) emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } });
  setInterval(() => {}, 1000);
} else {
  emit({ type: "system", subtype: "init" });
  delta("The database is ");
  emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: {} }] } });
  delta("touched by src/db.ts:1.");
  emit({ type: "result", subtype: "success", is_error: false, result: "The database is touched by src/db.ts:1." });
}
