import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_DENY, TOOL_DENY, askArgv, childEnv, explainFailure, parseStreamLine, systemPrompt } from "../src/serve/claude.ts";

const PREFIX = "/tmp/rl-ask-x/node /tmp/rl-ask-x/cli.ts query --out /tmp/rl-ask-x/out";
const SESSION = "11111111-1111-4111-8111-111111111111";
const deny = [...TOOL_DENY, ...SECRET_DENY.map((p) => `Read(${p})`)];
const expected = (resume: boolean, prompt: string) => [
  "-p",
  "--output-format", "stream-json", "--verbose", "--include-partial-messages",
  "--tools", "Read,Grep,Glob,Bash",
  "--allowedTools", `Bash(${PREFIX}:*)`,
  "--disallowedTools", ...deny,
  "--permission-mode", "dontAsk",
  "--setting-sources", "user",
  "--settings", JSON.stringify({ permissions: { deny } }),
  "--append-system-prompt", systemPrompt(PREFIX),
  resume ? "--resume" : "--session-id", SESSION,
  prompt,
];

test("askArgv: the whole array is pinned, first turn and follow-up", () => {
  assert.deepEqual(askArgv({ prompt: "  what touches the db?  ", session: SESSION, resume: false, cmdPrefix: PREFIX }), expected(false, "what touches the db?"));
  assert.deepEqual(askArgv({ prompt: "and then?", session: SESSION, resume: true, cmdPrefix: PREFIX }), expected(true, "and then?"));
});

test("askArgv: one Bash allow rule, no broad allows, no --bare, prompt last and never an option", () => {
  const a = askArgv({ prompt: "--dangerously-skip-permissions", session: SESSION, resume: false, cmdPrefix: PREFIX });
  const allowed = a.slice(a.indexOf("--allowedTools") + 1, a.indexOf("--disallowedTools"));
  assert.deepEqual(allowed, [`Bash(${PREFIX}:*)`]);
  for (const bare of ["Bash", "Bash(*)", "Read", "Write", "Edit"]) assert.ok(!allowed.includes(bare));
  assert.equal(a[a.indexOf("--tools") + 1], "Read,Grep,Glob,Bash");
  assert.ok(!a.includes("--bare"));
  assert.equal(a.at(-1), "Question: --dangerously-skip-permissions");
  assert.ok(a.includes("Bash(* --fresh*)"));
});

test("askArgv: every secret pattern is denied in --disallowedTools and in --settings", () => {
  const a = askArgv({ prompt: "x", session: SESSION, resume: false, cmdPrefix: PREFIX });
  const settings = JSON.parse(a[a.indexOf("--settings") + 1]).permissions.deny as string[];
  for (const p of SECRET_DENY) {
    assert.ok(a.includes(`Read(${p})`), p);
    assert.ok(settings.includes(`Read(${p})`), p);
  }
  for (const t of TOOL_DENY) assert.ok(settings.includes(t), t);
});

test("childEnv keeps what Claude Code needs and drops everything else", () => {
  const env = childEnv({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c", HTTPS_PROXY: "p", https_proxy: "p", LC_ALL: "C", GITHUB_TOKEN: "t", NODE_OPTIONS: "--x", SECRET_THING: "s", AWS_PROFILE: "a" });
  assert.deepEqual(Object.keys(env).sort(), ["ANTHROPIC_API_KEY", "AWS_PROFILE", "CLAUDE_CONFIG_DIR", "HOME", "HTTPS_PROXY", "LC_ALL", "PATH", "REPOLADDER_NO_USAGE", "REPOLADDER_READONLY", "https_proxy"]);
  assert.equal(env.REPOLADDER_READONLY, "1");
});

test("parseStreamLine maps Claude's stream-json and ignores the rest", () => {
  const delta = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } });
  assert.deepEqual(parseStreamLine(delta), [{ type: "text", text: "hi" }]);
  const tool = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x" }, { type: "tool_use", name: "Grep" }, { type: "tool_use", name: "Weird" }] } });
  assert.deepEqual(parseStreamLine(tool), [{ type: "tool", name: "Grep" }, { type: "tool", name: "Bash" }]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" })), [{ type: "result", ok: true, text: "done" }]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in" })), [{ type: "result", ok: false, text: "Not logged in", error: "Not logged in" }]);
  for (const junk of ["", "not json", "null", "42", '{"type":"nope"}', '{"type":"stream_event"}', '{"type":"assistant","message":null}']) assert.deepEqual(parseStreamLine(junk), []);
});

test("explainFailure gives a distinct plain-language code for each case", () => {
  const code = (f: Parameters<typeof explainFailure>[0]) => explainFailure(f).code;
  assert.equal(code({ spawnError: "ENOENT" }), "NO_CLAUDE");
  assert.equal(code({ exitCode: 1, stderr: "Not logged in. Please run /login" }), "SIGNED_OUT");
  assert.equal(code({ exitCode: 1, resultError: "Invalid API key · Please run /login" }), "SIGNED_OUT");
  assert.equal(code({ exitCode: 1, stderr: "error: unknown option '--x'" }), "OLD_CLI");
  assert.equal(code({ exitCode: 1, stderr: "429 rate limit" }), "RATE_LIMIT");
  assert.equal(code({ exitCode: 1, stderr: "Claude usage limit reached" }), "RATE_LIMIT");
  assert.equal(code({ timedOut: true }), "TIMEOUT");
  assert.equal(code({ exitCode: 3, stderr: "boom" }), "AGENT_FAILED");
});

test("explainFailure messages carry no stack traces or staged paths and cap stderr", () => {
  const m = explainFailure({ exitCode: 2, stderr: `\u0007Error: x\n    at foo (/tmp/rl-ask-abc/cli.ts:1:1)\n${"y".repeat(500)}` }).message;
  assert.ok(m.length < 320);
  assert.ok(!/[\u0000-\u001f]/.test(m));
  assert.match(m, /exit code 2/);
  for (const f of [{ spawnError: "ENOENT" }, { timedOut: true }, { stderr: "Not logged in" }, { stderr: "unknown option" }, { stderr: "429" }]) {
    assert.ok(!/\/tmp\/|\bat \w+ \(/.test(explainFailure(f).message));
  }
});
