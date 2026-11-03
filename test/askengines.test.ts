// One contract suite over both Ask engines, end to end against the fake binaries (test/helpers/fake-claude, fake-codex).
// The fakes prove what RepoLadder passes and how it reacts, not what either agent enforces (docs/serve-security.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { startServer, type Running } from "../src/serve/index.ts";
import { engineById, type EngineId } from "../src/serve/engines/index.ts";

const repo = fileURLToPath(new URL("fixtures/basic-app", import.meta.url));
const skip = process.platform === "win32" ? "fake agents are POSIX-only" : false;
const FAKES: Record<EngineId, { bin: string; env: string; mode: string; log: string; kid: string }> = {
  claude: { bin: fileURLToPath(new URL("helpers/fake-claude/claude.mjs", import.meta.url)), env: "REPOLADDER_CLAUDE_BIN", mode: "FAKE_CLAUDE_MODE", log: "FAKE_CLAUDE_LOG", kid: "FAKE_CLAUDE_KID" },
  codex: { bin: fileURLToPath(new URL("helpers/fake-codex/codex.mjs", import.meta.url)), env: "REPOLADDER_CODEX_BIN", mode: "FAKE_CODEX_MODE", log: "FAKE_CODEX_LOG", kid: "FAKE_CODEX_KID" },
};

type Res = { status: number; body: string };
const call = (s: Running, path: string, body?: string) => new Promise<Res>((resolve, reject) => {
  const headers: Record<string, string> = { host: `127.0.0.1:${s.port}`, "x-repoladder-token": s.token };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = request({ host: "127.0.0.1", port: s.port, path, method: body === undefined ? "GET" : "POST", headers }, (res) => {
    let b = "";
    res.on("data", (d) => (b += d));
    res.on("close", () => resolve({ status: res.statusCode!, body: b }));
    res.on("error", () => {});
  });
  r.on("error", reject);
  r.end(body);
});
const events = (r: Res) => r.body.trim().split("\n").map((l) => JSON.parse(l));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return f(); };

async function boot(t: { after(f: () => unknown): void }, id: EngineId) {
  const f = FAKES[id];
  const log = join(mkdtempSync(join(tmpdir(), "rl-eng-")), "log.jsonl");
  const extra: Record<string, string> = { [f.log]: log };
  process.env[f.env] = f.bin;
  const out = mkdtempSync(join(tmpdir(), "rl-engout-"));
  const s = await startServer({ page: () => "x", ask: { root: repo, out, agent: id, extraEnv: extra } });
  t.after(() => s.close());
  t.after(() => { delete process.env[f.env]; delete process.env.REPOLADDER_ASK_TIMEOUT_MS; });
  const ask = (q: string) => call(s, "/api/ask", JSON.stringify({ question: q }));
  const logs = () => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { s, extra, out, ask, logs, mode: (m: string) => { extra[f.mode] = m; } };
}

for (const id of ["claude", "codex"] as const) {
  const f = FAKES[id];
  const label = engineById(id).label;

  test(`[${id}] an answer streams and ends in done, in the repo, with an allowlisted env`, { skip }, async (t) => {
    const e = await boot(t, id);
    process.env.AWS_SECRET_ACCESS_KEY = "x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "ak-test";
    t.after(() => { delete process.env.AWS_SECRET_ACCESS_KEY; delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
    const st = JSON.parse((await call(e.s, "/api/ask/status")).body);
    assert.deepEqual(st.agent, { id, label });
    const ev = events(await e.ask("what touches the database?"));
    assert.equal(ev[0].type, "start");
    assert.ok(ev.some((x) => x.type === "text"));
    assert.ok(ev.some((x) => x.type === "tool"));
    assert.equal(ev.at(-1).type, "done");
    const [seen] = e.logs();
    assert.equal(seen.cwd, repo.replace(/\/$/, ""));
    const allowed = new Set(Object.keys(engineById(id).env({ ...process.env, ...e.extra })));
    // node adds a few names of its own to a child (e.g. __CF_USER_TEXT_ENCODING on macOS)
    assert.deepEqual(Object.keys(seen.env).filter((k) => !allowed.has(k) && !/^(FAKE_|__)/.test(k)), []);
    assert.equal(seen.env.AWS_SECRET_ACCESS_KEY === undefined, id === "codex");
    assert.equal(seen.env.OPENAI_API_KEY === undefined, id === "claude");
    assert.equal(seen.env.ANTHROPIC_API_KEY === undefined, id === "codex");
    assert.equal(seen.env.REPOLADDER_READONLY, "1");
  });

  test(`[${id}] done carries server-checked segments: an invented path is not a link`, { skip }, async (t) => {
    const e = await boot(t, id);
    e.mode("cites");
    writeFileSync(join(e.out, "facts.json"), JSON.stringify(analyze(repo)));
    const refs = events(await e.ask("where?")).at(-1).segments.filter((s: any) => s.ref);
    assert.deepEqual(refs.map((s: any) => [s.ref, s.verified]), [["src/lib/cart.ts:1", true], ["src/invented/ghost.ts", false]]);
  });

  test(`[${id}] failures map to the shared codes with no stack or staged path`, { skip }, async (t) => {
    const e = await boot(t, id);
    for (const [mode, code] of [["signedout", "SIGNED_OUT"], ["oldcli", "OLD_CLI"], ["ratelimit", "RATE_LIMIT"]] as const) {
      e.mode(mode);
      const last = events(await e.ask("hi")).at(-1);
      // a signed-out Codex is caught by the sign-in probe before a question is run
      const got = last.type === "error" ? last : { code: last.code, message: last.message };
      assert.equal(got.code, code, mode);
      assert.doesNotMatch(got.message, /rl-ask-|\bat .*:\d+|Error:/);
    }
    const e2 = await boot(t, id);
    process.env[f.env] = "/nonexistent/agent-nope";
    const st = JSON.parse((await call(e2.s, "/api/ask/status")).body);
    assert.equal(st.code, "NO_AGENT");
    assert.match(st.message, new RegExp(label));
  });

  test(`[${id}] a slow run times out, a busy ask is 429, and the cap kills the process group`, { skip }, async (t) => {
    const e = await boot(t, id);
    process.env.REPOLADDER_ASK_TIMEOUT_MS = "5000";
    e.mode("slow");
    const first = e.ask("one");
    await until(() => { try { return e.logs().length > 0; } catch { return false; } }, 4500);
    const busy = await e.ask("two");
    assert.equal(busy.status, 429);
    assert.equal(events(await first).at(-1).code, "TIMEOUT");
    delete process.env.REPOLADDER_ASK_TIMEOUT_MS;
    e.mode("manytools");
    e.extra[f.kid] = "1";
    const ev = events(await e.ask("many"));
    assert.equal(ev.at(-1).code, "TOO_MANY_STEPS");
    assert.match(ev.at(-1).message, new RegExp(label));
    const kid = e.logs().map((l) => l.childPid).find(Boolean) as number;
    assert.ok(kid);
    assert.ok(await until(() => !alive(kid)), "the grandchild survived");
  });
}
