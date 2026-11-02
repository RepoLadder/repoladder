// The Codex engine's pure parts: the whole argv, the env allowlist, the JSONL parser and the failure texts.
// Event shapes follow codex-rs/exec/src/exec_events.rs (openai/codex main, read 2026-11-02).
import { test } from "node:test";
import assert from "node:assert/strict";
import { codexEngine, codexParser, codexPrompt } from "../src/serve/engines/codex.ts";

const req = { cmdPrefix: "/tmp/rl-ask-x/rl", guardCmd: "unused", resume: false };

test("the whole Codex argv is pinned, read-only and never-ask, the question last after `--`", () => {
  const argv = codexEngine.argv({ ...req, prompt: "what touches the db?" });
  assert.deepEqual(argv.slice(0, -1), ["exec", "--sandbox", "read-only", "-c", 'approval_policy="never"', "--json", "--color", "never", "--skip-git-repo-check", "--"]);
  assert.equal(argv.at(-1), codexPrompt(req.cmdPrefix, "what touches the db?"));
  assert.match(argv.at(-1)!, /Question: what touches the db\?$/);
});

test("a question starting with a dash cannot become an option, and a follow-up keeps every flag", () => {
  const first = codexEngine.argv({ ...req, prompt: "--dangerously-bypass-approvals-and-sandbox" });
  const follow = codexEngine.argv({ ...req, prompt: "--dangerously-bypass-approvals-and-sandbox", resume: true, session: "abc" });
  assert.deepEqual(follow, first);
  assert.ok(first.slice(0, first.indexOf("--")).every((a) => !a.includes("dangerously")));
  assert.ok(first.at(-1)!.startsWith("You answer"));
  assert.equal(first.indexOf("--sandbox") + 1, first.indexOf("read-only"));
});

test("env keeps the base and Codex names and drops other agents' credentials", () => {
  const env = codexEngine.env({ PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "k", CODEX_HOME: "/c", ANTHROPIC_API_KEY: "a", CLAUDE_X: "c", AWS_SECRET_ACCESS_KEY: "s", GOOGLE_APPLICATION_CREDENTIALS: "g", GITHUB_TOKEN: "t", HTTPS_PROXY: "p" });
  assert.deepEqual(Object.keys(env).sort(), ["CODEX_HOME", "HOME", "HTTPS_PROXY", "OPENAI_API_KEY", "PATH", "REPOLADDER_NO_USAGE", "REPOLADDER_READONLY"]);
});

test("the parser maps each event type and never throws", () => {
  const p = codexParser();
  const L = (o: unknown) => p(JSON.stringify(o));
  assert.deepEqual(L({ type: "thread.started", thread_id: "t1" }), [{ type: "session", id: "t1" }]);
  assert.deepEqual(L({ type: "turn.started" }), []);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "command_execution", command: "ls", aggregated_output: "", exit_code: 0, status: "completed" } }), [{ type: "tool", name: "Bash" }]);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "file_change", changes: [], status: "completed" } }), [{ type: "tool", name: "Bash" }]);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "web_search", query: "q", action: {} } }), [{ type: "tool", name: "Bash" }]);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "mcp_tool_call", server: "s", tool: "t", status: "completed" } }), [{ type: "tool", name: "Bash" }]);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "reasoning", text: "hmm" } }), []);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "agent_message", text: "first" } }), [{ type: "text", text: "first" }]);
  assert.deepEqual(L({ type: "item.completed", item: { id: "i", type: "agent_message", text: "final" } }), [{ type: "text", text: "final" }]);
  assert.deepEqual(L({ type: "turn.completed", usage: {} }), [{ type: "result", ok: true, text: "final" }]);
  assert.deepEqual(L({ type: "turn.failed", error: { message: "boom" } }), [{ type: "result", ok: false, text: "", error: "boom" }]);
  assert.deepEqual(L({ type: "error", message: "bad" }), [{ type: "result", ok: false, text: "", error: "bad" }]);
  for (const junk of ["", "not json", '{"type":"item.comp', "null", "[]", "42", '{"type":"item.completed"}', '{"type":"thread.started","thread_id":5}']) assert.deepEqual(p(junk), [], junk);
});

test("each failure code has Codex wording, with no staged path and a short stderr", () => {
  const f = codexEngine.explainFailure;
  assert.equal(f({ spawnError: "ENOENT" }).code, "NO_AGENT");
  assert.equal(f({ timedOut: true }).code, "TIMEOUT");
  assert.equal(f({ stderr: "error: unexpected argument '--json'" }).code, "OLD_CLI");
  assert.equal(f({ stderr: "Not logged in" }).code, "SIGNED_OUT");
  assert.match(f({ stderr: "x" , resultError: "Not logged in" }).message, /codex login/);
  assert.equal(f({ resultError: "429 usage limit reached" }).code, "RATE_LIMIT");
  const other = f({ exitCode: 3, stderr: "x".repeat(500) });
  assert.equal(other.code, "AGENT_FAILED");
  assert.ok(other.message.length < 300);
});
