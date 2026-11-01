// Ask endpoint, end to end against a fake `claude` (test/helpers/fake-claude). The fake proves the arguments, not Claude Code's enforcement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { analyze } from "../src/analyze/index.ts";
import { startServer, type Running } from "../src/serve/index.ts";
import { askArgv } from "../src/serve/claude.ts";

const repo = fileURLToPath(new URL("fixtures/basic-app", import.meta.url));
const fake = fileURLToPath(new URL("helpers/fake-claude/claude.mjs", import.meta.url));
const skip = process.platform === "win32" ? "fake claude is POSIX-only" : false;

type Res = { status: number; headers: Record<string, unknown>; body: string };
type Env = { s: Running; log: string; extra: Record<string, string>; out: string };

async function boot(t: { after(f: () => unknown): void }, ask: boolean = true): Promise<Env> {
  const log = join(mkdtempSync(join(tmpdir(), "rl-askt-")), "log.jsonl");
  const extra: Record<string, string> = { FAKE_CLAUDE_LOG: log };
  process.env.REPOLADDER_CLAUDE_BIN = fake;
  const out = mkdtempSync(join(tmpdir(), "rl-askout-"));
  const s = await startServer({ page: () => "x", ask: ask ? { root: repo, out, extraEnv: extra } : false });
  t.after(() => s.close());
  t.after(() => { delete process.env.REPOLADDER_CLAUDE_BIN; delete process.env.REPOLADDER_ASK_TIMEOUT_MS; });
  return { s, log, extra, out };
}

const call = (s: Running, method: string, path: string, o: { body?: string; type?: string; token?: string | null; host?: string } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const headers: Record<string, string> = { host: o.host ?? `127.0.0.1:${s.port}` };
    if (o.token !== null) headers["x-repoladder-token"] = o.token ?? s.token;
    if (o.body !== undefined) headers["content-type"] = o.type ?? "application/json";
    const r = request({ host: "127.0.0.1", port: s.port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("close", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      res.on("error", () => {});
    });
    r.on("error", reject);
    r.end(o.body);
  });

const ask = (s: Running, q: unknown, conversation?: string) => call(s, "POST", "/api/ask", { body: JSON.stringify({ question: q, conversation }) });
const events = (r: Res) => r.body.trim().split("\n").map((l) => JSON.parse(l));
const logs = (e: Env) => readFileSync(e.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return f(); };

test("ask streams start, text, tool, done from the CLI run in the repo", { skip }, async (t) => {
  const e = await boot(t);
  process.env.GITHUB_TOKEN = "leak-me";
  t.after(() => { delete process.env.GITHUB_TOKEN; });
  const r = await ask(e.s, "what touches the database?");
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-type"]), /application\/x-ndjson/);
  assert.equal(r.headers["cache-control"], "no-store");
  const ev = events(r);
  assert.equal(ev[0].type, "start");
  assert.match(ev[0].conversation, /^[0-9a-f]{16}$/);
  const text = ev.filter((x) => x.type === "text").map((x) => x.text).join("");
  assert.ok(ev.some((x) => x.type === "text"));
  assert.deepEqual(ev.find((x) => x.type === "tool"), { type: "tool", name: "Grep" });
  assert.deepEqual(ev.at(-1), { type: "done", text, segments: null, conversation: ev[0].conversation });
  const [seen] = logs(e);
  assert.equal(seen.cwd, repo.replace(/\/$/, ""));
  assert.equal(seen.env.GITHUB_TOKEN, undefined);
  assert.equal(seen.env.REPOLADDER_READONLY, "1");
  assert.equal(seen.env.REPOLADDER_NO_USAGE, "1");
  const sessionIdx = seen.argv.indexOf("--session-id");
  const stagedPrefix = seen.argv[seen.argv.indexOf("--allowedTools") + 1].slice("Bash(".length, -":*)".length);
  assert.deepEqual(seen.argv, askArgv({ prompt: "what touches the database?", session: seen.argv[sessionIdx + 1], resume: false, cmdPrefix: stagedPrefix }));
});

test("a follow-up resumes the same Claude session and no session id reaches the browser", { skip }, async (t) => {
  const e = await boot(t);
  const first = await ask(e.s, "one");
  const conv = events(first)[0].conversation;
  const second = await ask(e.s, "two", conv);
  const [a, b] = logs(e);
  const uuid = a.argv[a.argv.indexOf("--session-id") + 1];
  assert.equal(b.argv[b.argv.indexOf("--resume") + 1], uuid);
  assert.ok(!b.argv.includes("--session-id"));
  assert.equal(events(second)[0].conversation, conv);
  assert.ok(!first.body.includes(uuid) && !second.body.includes(uuid));
});

test("status reports the CLI, or a plain reason when it is missing", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "version";
  const ok = JSON.parse((await call(e.s, "GET", "/api/ask/status")).body);
  assert.deepEqual(ok, { available: true, version: "9.9.9 (Claude Code)", starters: [] });

  const e2 = await boot(t);
  process.env.REPOLADDER_CLAUDE_BIN = "/nonexistent/claude-nope";
  const st = JSON.parse((await call(e2.s, "GET", "/api/ask/status")).body);
  assert.equal(st.available, false);
  assert.equal(st.code, "NO_CLAUDE");
  assert.match(st.message, /isn't installed/);
  const ev = events(await ask(e2.s, "hi"));
  assert.deepEqual(ev.at(-1), { type: "error", code: "NO_CLAUDE", message: st.message });
});

test("signed-out, old CLI and rate limit each get their own error event", { skip }, async (t) => {
  const e = await boot(t);
  for (const [mode, code] of [["signedout", "SIGNED_OUT"], ["oldcli", "OLD_CLI"], ["ratelimit", "RATE_LIMIT"]]) {
    e.extra.FAKE_CLAUDE_MODE = mode;
    const last = events(await ask(e.s, "hi")).at(-1);
    assert.equal(last.type, "error");
    assert.equal(last.code, code, mode);
    assert.ok(!/\/tmp\/|rl-ask-/.test(last.message));
  }
});

test("a slow turn times out and its child is gone", { skip }, async (t) => {
  const e = await boot(t);
  process.env.REPOLADDER_ASK_TIMEOUT_MS = "300";
  e.extra.FAKE_CLAUDE_MODE = "slow";
  const last = events(await ask(e.s, "hi")).at(-1);
  assert.equal(last.code, "TIMEOUT");
  const [seen] = logs(e);
  assert.ok(await until(() => !alive(seen.pid)), "child still running");
});

test("more than 25 tool calls stops the turn", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "manytools";
  const last = events(await ask(e.s, "hi")).at(-1);
  assert.equal(last.code, "TOO_MANY_STEPS");
  const [seen] = logs(e);
  assert.ok(await until(() => !alive(seen.pid)));
});

test("a client that disconnects kills the child", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "slow";
  await new Promise<void>((resolve) => {
    const r = request({ host: "127.0.0.1", port: e.s.port, path: "/api/ask", method: "POST", headers: { host: `127.0.0.1:${e.s.port}`, "x-repoladder-token": e.s.token, "content-type": "application/json" } }, (res) => {
      res.once("data", () => { until(() => existsSync(e.log)).then(() => { r.destroy(); resolve(); }); });
    });
    r.on("error", () => {});
    r.end(JSON.stringify({ question: "hi" }));
  });
  const [seen] = logs(e);
  assert.ok(await until(() => !alive(seen.pid)), "child survived the disconnect");
});

test("closing the server kills live children and removes the staged directory", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "slow";
  const pending = ask(e.s, "hi").catch(() => undefined);
  assert.ok(await until(() => existsSync(e.log)));
  const [seen] = logs(e);
  const prefix = seen.argv[seen.argv.indexOf("--allowedTools") + 1] as string;
  const dir = prefix.slice("Bash(".length).split("/node ")[0];
  assert.ok(existsSync(dir));
  await e.s.close();
  assert.ok(!existsSync(dir), "staged dir left behind");
  assert.ok(await until(() => !alive(seen.pid)));
  await pending;
});

test("both ask routes sit behind the token and Host checks", { skip }, async (t) => {
  const e = await boot(t);
  for (const [m, p] of [["GET", "/api/ask/status"], ["POST", "/api/ask"]]) {
    assert.equal((await call(e.s, m, p, { token: null, body: m === "POST" ? "{}" : undefined })).status, 401);
    assert.equal((await call(e.s, m, p, { host: "evil.example:80", body: m === "POST" ? "{}" : undefined })).status, 403);
  }
});

test("input validation: content type, JSON, question, size, conversation", { skip }, async (t) => {
  const e = await boot(t);
  const post = (body: string, type?: string) => call(e.s, "POST", "/api/ask", { body, type });
  assert.equal((await post("{}", "text/plain")).status, 415);
  for (const b of ["not json", "{}", '{"question":""}', '{"question":"   "}', '{"question":5}']) {
    const r = await post(b);
    assert.equal(r.status, 400, b);
    assert.equal(JSON.parse(r.body).error.code, "BAD_QUESTION");
  }
  assert.equal((await post(JSON.stringify({ question: "a\u0000b" }))).status, 400);
  const big = await post(JSON.stringify({ question: "x".repeat(70 * 1024) }));
  assert.equal(big.status, 413);
  const unk = await post(JSON.stringify({ question: "hi", conversation: "deadbeefdeadbeef" }));
  assert.equal(unk.status, 400);
  assert.equal(JSON.parse(unk.body).error.code, "UNKNOWN_CONVERSATION");
  assert.ok(!existsSync(e.log), "the CLI must not run for rejected input");
});

test("with ask off both URLs are 404", { skip }, async (t) => {
  const e = await boot(t, false);
  assert.equal((await call(e.s, "GET", "/api/ask/status")).status, 404);
  assert.equal((await call(e.s, "POST", "/api/ask", { body: '{"question":"x"}' })).status, 405);
});

test("the done event carries segments checked against the facts on disk, and a rebuilt facts.json is picked up", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "cites";
  const facts = analyze(repo);
  writeFileSync(join(e.out, "facts.json"), JSON.stringify(facts));
  const refs = (r: Res) => events(r).at(-1).segments.filter((s: any) => s.ref);
  const first = refs(await ask(e.s, "where?"));
  assert.deepEqual(first.map((s: any) => [s.ref, s.verified]), [["src/lib/cart.ts:1", true], ["src/invented/ghost.ts", false]]);
  assert.equal(first[1].reason, "not found in the code facts");
  // the browser cannot supply segments
  const forged = JSON.stringify({ question: "x", segments: [{ ref: "src/invented/ghost.ts", verified: true }] });
  const r = await call(e.s, "POST", "/api/ask", { body: forged });
  assert.equal(refs(r)[1].verified, false);
  // a rebuild that drops the file is seen on the next turn
  facts.files = facts.files.filter((f) => f.path !== "src/lib/cart.ts");
  writeFileSync(join(e.out, "facts.json"), JSON.stringify(facts));
  assert.equal(refs(await ask(e.s, "again"))[0].verified, false);
});

test("without facts the done event has segments: null", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "cites";
  assert.equal(events(await ask(e.s, "where?")).at(-1).segments, null);
});
