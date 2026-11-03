// Choosing the Ask agent: the flag, REPOLADDER_AGENT, auto-detect order, and what the CLI rejects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type Running } from "../src/serve/index.ts";
import { chooseAgent, parseAgentChoice, type AgentChoice } from "../src/serve/engines/index.ts";

const repo = fileURLToPath(new URL("fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const claude = fileURLToPath(new URL("helpers/fake-claude/claude.mjs", import.meta.url));
const codex = fileURLToPath(new URL("helpers/fake-codex/codex.mjs", import.meta.url));
const skip = process.platform === "win32" ? "fake agents are POSIX-only" : false;
const NOPE = "/nonexistent/nope";

const call = (s: Running, path: string, body?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const headers: Record<string, string> = { host: `127.0.0.1:${s.port}`, "x-repoladder-token": s.token };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = request({ host: "127.0.0.1", port: s.port, path, method: body === undefined ? "GET" : "POST", headers }, (res) => {
    let b = "";
    res.on("data", (d) => (b += d));
    res.on("close", () => resolve({ status: res.statusCode!, body: b }));
  });
  r.on("error", reject);
  r.end(body);
});

async function status(t: { after(f: () => unknown): void }, agent: AgentChoice | undefined, bins: { claude: string; codex: string }) {
  process.env.REPOLADDER_CLAUDE_BIN = bins.claude;
  process.env.REPOLADDER_CODEX_BIN = bins.codex;
  const s = await startServer({ page: () => "x", ask: { root: repo, out: mkdtempSync(join(tmpdir(), "rl-flag-")), agent } });
  t.after(() => { s.close(); delete process.env.REPOLADDER_CLAUDE_BIN; delete process.env.REPOLADDER_CODEX_BIN; });
  return { s, st: JSON.parse((await call(s, "/api/ask/status")).body) };
}

test("parseAgentChoice and chooseAgent: flag beats env, env beats auto, bad values are undefined", () => {
  assert.equal(parseAgentChoice("codex"), "codex");
  assert.equal(parseAgentChoice("gemini"), undefined);
  assert.equal(chooseAgent("codex", { REPOLADDER_AGENT: "claude" }), "codex");
  assert.equal(chooseAgent(undefined, { REPOLADDER_AGENT: "codex" }), "codex");
  assert.equal(chooseAgent(undefined, {}), "auto");
  assert.equal(chooseAgent(true, {}), undefined);
  assert.equal(chooseAgent(undefined, { REPOLADDER_AGENT: "nope" }), undefined);
});

test("auto picks Claude when both exist, Codex when only Codex does, NO_AGENT when neither", { skip }, async (t) => {
  assert.equal((await status(t, undefined, { claude, codex })).st.agent.id, "claude");
  assert.equal((await status(t, "auto", { claude: NOPE, codex })).st.agent.id, "codex");
  const none = (await status(t, undefined, { claude: NOPE, codex: NOPE })).st;
  assert.equal(none.code, "NO_AGENT");
  assert.match(none.message, /Claude Code or Codex/);
});

test("a named agent is never swapped for the other", { skip }, async (t) => {
  const r = (await status(t, "codex", { claude, codex: NOPE })).st;
  assert.equal(r.available, false);
  assert.equal(r.code, "NO_AGENT");
  assert.match(r.message, /Codex/);
  assert.doesNotMatch(r.message, /Claude/);
});

test("a conversation from one agent is rejected after the active agent changes; the browser cannot pick the engine", { skip }, async (t) => {
  const { s } = await status(t, "auto", { claude, codex });
  const body = JSON.stringify({ question: "hi", agent: "codex", engine: "codex" });
  const first = (await call(s, "/api/ask", body)).body.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(first.at(-1).type, "done");
  assert.ok(first.at(-1).text.includes("src/db.ts"), "the Claude fake answered, whatever the body said");
  const convo = first[0].conversation;
  // Claude goes away; once the 10 s status cache lapses the probe settles on Codex
  process.env.REPOLADDER_CLAUDE_BIN = NOPE;
  await new Promise((r) => setTimeout(r, 10_200));
  assert.equal(JSON.parse((await call(s, "/api/ask/status")).body).agent.id, "codex");
  const again = await call(s, "/api/ask", JSON.stringify({ question: "x", conversation: convo }));
  assert.equal(again.status, 400);
  assert.equal(JSON.parse(again.body).error.code, "UNKNOWN_CONVERSATION");
});

test("the CLI rejects a bare, invalid or env-invalid agent with exit 2 and INVALID_OPTIONS", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "rl-flagcli-"));
  const env = { ...process.env, REPOLADDER_NO_USAGE: "1" };
  for (const args of [["--agent"], ["--agent", "gemini"], ["--agent", "auto"]]) {
    const r = spawnSync(process.execPath, [cli, "serve", repo, "--no-open", "--out", out, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /INVALID_OPTIONS: --agent needs claude or codex/);
  }
  const r = spawnSync(process.execPath, [cli, "serve", repo, "--no-open", "--out", out], { env: { ...env, REPOLADDER_AGENT: "nope" }, encoding: "utf8" });
  assert.equal(r.status, 2);
});
