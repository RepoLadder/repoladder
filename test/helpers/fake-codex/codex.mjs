#!/usr/bin/env node
// A fake `codex` for the Ask tests. Logs what it was given to FAKE_CODEX_LOG, then behaves per FAKE_CODEX_MODE.
// The JSONL shapes follow codex-rs/exec/src/exec_events.rs (openai/codex main, read 2026-11-02); no real Codex was run.
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.env.FAKE_CODEX_MODE || "ok";
const argv = process.argv.slice(2);
const log = (extra = {}) => process.env.FAKE_CODEX_LOG && appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, cwd: process.cwd(), env: process.env, pid: process.pid, ...extra }) + "\n");
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (argv[0] === "--version") {
  console.log(mode === "version" ? "codex-cli 9.9.9" : "codex-cli 0.1.0");
  process.exit(0);
}
if (argv[0] === "login" && argv[1] === "status") {
  if (mode === "signedout") { console.error("Not logged in"); process.exit(1); }
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
log();
const msg = (text) => emit({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } });
const cmd = () => emit({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "rg db", aggregated_output: "", exit_code: 0, status: "completed" } });
if (mode === "oldcli") { console.error("error: unexpected argument '--json' found"); process.exit(2); }
if (mode === "ratelimit") { console.error("stream error: 429 usage limit reached"); process.exit(1); }
emit({ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" });
emit({ type: "turn.started" });
if (mode === "slow") setInterval(() => {}, 1000);
else if (mode === "grandchild") {
  log({ childPid: spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid });
  setInterval(() => {}, 1000);
} else if (mode === "manytools") {
  if (process.env.FAKE_CODEX_KID) log({ childPid: spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid });
  for (let i = 0; i < 40; i++) cmd();
  setInterval(() => {}, 1000);
} else if (mode === "cites") {
  msg(process.env.FAKE_CODEX_TEXT || "It lives in src/lib/cart.ts:1 but not in src/invented/ghost.ts.");
  emit({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
} else {
  cmd();
  msg("The database is touched by src/db.ts:1.");
  emit({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
}
