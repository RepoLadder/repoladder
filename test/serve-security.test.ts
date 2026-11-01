// Adversarial layer for `repoladder serve` and the Ask path (#33): token on every route, cross-origin, limits, process cleanup, argv, environment, secrets, logs.
// Loopback only, against the fake claude (test/helpers/fake-claude). The fake proves the arguments RepoLadder passes, not Claude Code's own enforcement (docs/serve-security.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { request } from "node:http";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type Running } from "../src/serve/index.ts";
import { SECRET_DENY, askArgv } from "../src/serve/claude.ts";
import { compileGlob } from "../src/model/glob.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = join(root, "test/fixtures/basic-app");
const fake = join(root, "test/helpers/fake-claude/claude.mjs");
const cli = join(root, "src/cli.ts");
const skip = process.platform === "win32" ? "POSIX-only (fake claude, process groups)" : false;

type Res = { status: number; headers: Record<string, unknown>; body: string };
type Env = { s: Running; log: string; extra: Record<string, string> };
type Opts = { body?: string; token?: string | null; host?: string | null; headers?: Record<string, string>; query?: boolean };

async function boot(t: { after(f: () => unknown): void }): Promise<Env> {
  const log = join(mkdtempSync(join(tmpdir(), "rl-sect-")), "log.jsonl");
  const extra: Record<string, string> = { FAKE_CLAUDE_LOG: log };
  process.env.REPOLADDER_CLAUDE_BIN = fake;
  const s = await startServer({ page: () => "x", ask: { root: repo, out: mkdtempSync(join(tmpdir(), "rl-sectout-")), extraEnv: extra } });
  t.after(() => s.close());
  t.after(() => { delete process.env.REPOLADDER_CLAUDE_BIN; delete process.env.REPOLADDER_ASK_TIMEOUT_MS; });
  return { s, log, extra };
}

const call = (s: Running, method: string, path: string, o: Opts = {}) =>
  new Promise<Res>((resolve, reject) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.host !== null) headers.host = o.host ?? `127.0.0.1:${s.port}`;
    if (o.token !== null) headers["x-repoladder-token"] = o.token ?? s.token;
    if (o.body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const r = request({ host: "127.0.0.1", port: s.port, path, method, headers, setHost: o.host !== null }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("close", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      res.on("error", () => {});
    });
    r.on("error", reject);
    r.end(o.body);
  });

const q = (question: string, extra: Record<string, unknown> = {}) => JSON.stringify({ question, ...extra });
const logs = (e: Env) => (existsSync(e.log) ? readFileSync(e.log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return f(); };
const noCors = (r: Res) => assert.deepEqual(Object.keys(r.headers).filter((h) => h.startsWith("access-control-")), []);
const errCode = (r: Res) => JSON.parse(r.body).error.code;

test("every registered route needs the token in a header: none, wrong, or in the query is 401", { skip }, async (t) => {
  const e = await boot(t);
  assert.ok(e.s.routes.length >= 2);
  for (const key of e.s.routes) {
    const [method, path] = key.split(" ");
    const body = method === "POST" ? q("hi") : undefined;
    for (const [label, o] of [["no token", { token: null }], ["wrong token", { token: "0".repeat(64) }], ["query token", { token: null }]] as const) {
      const r = await call(e.s, method, label === "query token" ? `${path}?t=${e.s.token}` : path, { ...o, body });
      assert.equal(r.status, 401, `${key}: ${label}`);
      noCors(r);
    }
  }
  assert.equal((await call(e.s, "GET", "/api/ask/status")).status, 200);
});

test("cross-origin requests are refused 403 and never get CORS headers", { skip }, async (t) => {
  const e = await boot(t);
  const cases: Record<string, string>[] = [{ origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: `http://127.0.0.1:${e.s.port}.evil.example` }, { origin: `http://127.0.0.1:${e.s.port + 1}` }];
  for (const headers of cases) {
    for (const [m, p, body] of [["POST", "/api/ask", q("hi")], ["GET", "/api/ask/status", undefined]] as const) {
      const r = await call(e.s, m, p, { headers, body });
      assert.equal(r.status, 403, `${m} ${p} ${JSON.stringify(headers)}`);
      noCors(r);
    }
  }
  assert.ok(!existsSync(e.log), "a refused request must not start the CLI");
  const ok = await call(e.s, "GET", "/api/ask/status", { headers: { origin: `http://127.0.0.1:${e.s.port}`, "sec-fetch-site": "same-origin" } });
  assert.equal(ok.status, 200);
  noCors(ok);
  const pre = await call(e.s, "OPTIONS", "/api/ask", { token: null, headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  assert.ok([401, 403, 405].includes(pre.status));
  noCors(pre);
  const nav = await call(e.s, "GET", `/?t=${e.s.token}`, { token: null, headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(nav.status, 200, "a top-level navigation to the first URL still works");
});

test("a bad or missing Host is 403 with and without a token", { skip }, async (t) => {
  const e = await boot(t);
  for (const host of ["evil.example", `127.0.0.1.evil.example:${e.s.port}`, null]) {
    for (const token of [null, undefined]) {
      const r = await call(e.s, "GET", "/api/ask/status", { host, token });
      // Node itself answers 400 to an HTTP/1.1 request with no Host; either way no route runs
      assert.ok(host === null ? r.status === 400 || r.status === 403 : r.status === 403, `${host} ${token}: ${r.status}`);
      noCors(r);
    }
  }
});

test("question, body and concurrency limits", { skip }, async (t) => {
  const e = await boot(t);
  const long = await call(e.s, "POST", "/api/ask", { body: q("a".repeat(2001)) });
  assert.equal(long.status, 400);
  assert.equal(errCode(long), "QUESTION_TOO_LONG");
  assert.equal((await call(e.s, "POST", "/api/ask", { body: q("a".repeat(2000)) })).status, 200);
  assert.equal((await call(e.s, "POST", "/api/ask", { body: q("a\u0000b") })).status, 400);
  assert.equal(errCode(await call(e.s, "POST", "/api/ask", { body: q("hi", { conversation: "../../etc/passwd" }) })), "UNKNOWN_CONVERSATION");
  const big = await call(e.s, "POST", "/api/ask", { body: q("x".repeat(17 * 1024)) });
  assert.equal(big.status, 413);
  assert.equal(errCode(big), "BODY_TOO_LARGE");

  // chunked body over the cap: refused 413 and the connection closes
  const chunked = await new Promise<{ head: string; closed: boolean }>((resolve) => {
    const sock = connect(e.s.port, "127.0.0.1");
    let head = "";
    sock.on("data", (d) => (head += d));
    sock.on("close", () => resolve({ head, closed: true }));
    sock.on("error", () => {});
    sock.write(`POST /api/ask HTTP/1.1\r\nHost: 127.0.0.1:${e.s.port}\r\nx-repoladder-token: ${e.s.token}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`);
    const piece = "a".repeat(4096);
    for (let i = 0; i < 6; i++) sock.write(`${piece.length.toString(16)}\r\n${piece}\r\n`);
    setTimeout(() => sock.destroy(), 3000).unref();
  });
  assert.match(chunked.head, /^HTTP\/1\.1 413/);
  assert.ok(chunked.closed);

  // concurrency: one live ask at a time
  e.extra.FAKE_CLAUDE_MODE = "slow";
  const first = call(e.s, "POST", "/api/ask", { body: q("one") }).catch(() => undefined);
  assert.ok(await until(() => logs(e).length > 0 && existsSync(e.log)));
  const busyAt = logs(e).length;
  const second = await call(e.s, "POST", "/api/ask", { body: q("two") });
  assert.equal(second.status, 429);
  assert.equal(errCode(second), "ASK_BUSY");
  assert.equal(logs(e).length, busyAt, "a refused ask must not start the CLI");
  await e.s.close();
  await first;
});

test("the ask slot frees after done, error and timeout", { skip }, async (t) => {
  const e = await boot(t);
  const post = () => call(e.s, "POST", "/api/ask", { body: q("hi") });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  e.extra.FAKE_CLAUDE_MODE = "signedout";
  assert.equal((await post()).status, 200);
  process.env.REPOLADDER_ASK_TIMEOUT_MS = "300";
  e.extra.FAKE_CLAUDE_MODE = "slow";
  assert.match((await post()).body, /TIMEOUT/);
  e.extra.FAKE_CLAUDE_MODE = "ok";
  const r = await post();
  assert.equal(r.status, 200);
  assert.match(r.body, /"type":"done"/);
});

test("header block over 16 KB is refused, TRACE is 405, traversal finds nothing", { skip }, async (t) => {
  const e = await boot(t);
  const big = await call(e.s, "GET", "/api/ask/status", { headers: { "x-junk": "a".repeat(17 * 1024) } }).catch(() => ({ status: 0 }) as Res);
  assert.ok(big.status === 431 || big.status === 0, `status ${big.status}`);
  assert.equal((await call(e.s, "TRACE", "/")).status, 405);
  assert.equal((await call(e.s, "PUT", "/api/ask", { body: "{}" })).status, 405);
  for (const p of ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "//x", "/api/ask/../status"]) {
    const r = await call(e.s, "GET", p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /root:/);
  }
});

const argvOf = (e: Env) => logs(e)[0].argv as string[];
const after = (a: string[], flag: string) => a[a.indexOf(flag) + 1];

test("argv carries exactly the allowlist and a hostile question changes nothing else", { skip }, async (t) => {
  const e = await boot(t);
  await call(e.s, "POST", "/api/ask", { body: q("what touches the database?") });
  const base = argvOf(e);
  assert.equal(after(base, "--tools"), "Read,Grep,Glob,Bash");
  const allowed = base.slice(base.indexOf("--allowedTools") + 1, base.indexOf("--disallowedTools"));
  assert.equal(allowed.length, 1);
  assert.match(allowed[0], /^Bash\(.* query --out [^ ]+:\*\)$/);
  assert.deepEqual(allowed.filter((a) => /^(Bash|Write|Edit|Read)$/.test(a)), []);
  assert.equal(after(base, "--permission-mode"), "dontAsk");
  assert.equal(after(base, "--setting-sources"), "user");
  for (const bad of ["--bare", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions"]) assert.ok(!base.includes(bad), bad);
  const stripped = (a: string[]) => a.filter((x, i) => i !== a.length - 1 && x !== after(a, "--session-id"));
  for (const hostile of ['"; rm -rf / #', "--allowedTools Bash", "line one\nline \"two\" 'three'\n--permission-mode bypassPermissions"]) {
    await call(e.s, "POST", "/api/ask", { body: q(hostile) });
    const a = logs(e).at(-1).argv as string[];
    assert.ok(a.at(-1)!.endsWith(hostile.trim()) || a.at(-1) === hostile.trim() || a.at(-1) === `Question: ${hostile.trim()}`);
    assert.equal(a.filter((x) => x.includes(hostile.trim())).length, 1, "the question appears once, as one element");
    assert.deepEqual(stripped(a), stripped(base));
  }
});

test("the child's environment holds only allowlisted names", { skip }, async (t) => {
  const e = await boot(t);
  const set: string[] = [];
  const put = (k: string, v: string) => { process.env[k] = v; set.push(k); };
  t.after(() => { for (const k of set) delete process.env[k]; });
  for (let i = 0; i < 50; i++) put(`RL_RANDOM_${i}_${Math.random().toString(36).slice(2)}`, "x");
  put("GITHUB_TOKEN", "leak"); put("NPM_TOKEN", "leak"); put("NODE_OPTIONS", "--max-old-space-size=64"); put("AWS_SECRET_ACCESS_KEY", "kept-by-design");
  await call(e.s, "POST", "/api/ask", { body: q("hi") });
  const env = logs(e)[0].env as Record<string, string>;
  for (const k of ["GITHUB_TOKEN", "NPM_TOKEN", "NODE_OPTIONS"]) assert.equal(env[k], undefined, k);
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("RL_RANDOM_")), []);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, "kept-by-design");
});

test("every secret deny pattern is in both deny layers; the path tables behave", () => {
  const argv = askArgv({ prompt: "q", session: "s", resume: false, cmdPrefix: "/x/node /x/cli.mjs query --out /x/out" });
  const flagDeny = argv.slice(argv.indexOf("--disallowedTools") + 1, argv.indexOf("--permission-mode"));
  const settings = JSON.parse(after(argv, "--settings")).permissions.deny as string[];
  for (const p of SECRET_DENY) {
    assert.ok(flagDeny.includes(`Read(${p})`), `--disallowedTools lacks ${p}`);
    assert.ok(settings.includes(`Read(${p})`), `--settings lacks ${p}`);
  }
  const hits = (path: string) => SECRET_DENY.filter((p) => !p.startsWith("~/")).some((p) => compileGlob(p).re.test(path));
  for (const p of [".env", "web/.env.local", "keys/server.pem", "deploy/id_rsa", "a/secrets/x.json", ".aws/credentials", "service-account-prod.json"]) assert.ok(hits(p), `not denied: ${p}`);
  for (const p of ["src/env.ts", "src/keys.ts", "docs/credentials.md"]) assert.ok(!hits(p), `wrongly denied: ${p}`);
});

const snapshot = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? f : `${f}:${readFileSync(p).length}:${readFileSync(p, "utf8").length}:${statSync(p).mtimeMs}`; });

test("query is read-only: every kind leaves the tree untouched and --fresh is refused", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "rl-ro-"));
  cpSync(repo, dir, { recursive: true });
  const out = join(dir, ".out");
  const env = { ...process.env, REPOLADDER_NO_USAGE: "1" };
  assert.equal(spawnSync(process.execPath, [cli, "analyze", dir, "--out", out], { env, encoding: "utf8" }).status, 0);
  const before = snapshot(dir);
  const ro = { ...env, REPOLADDER_READONLY: "1" };
  for (const [kind, arg] of [["definitions", "x"], ["importers", "src/db.ts"], ["callers", "x"], ["touches", "x"], ["files", "src"]]) {
    spawnSync(process.execPath, [cli, "query", dir, kind, arg, "--out", out], { env: ro, encoding: "utf8" });
  }
  assert.deepEqual(snapshot(dir), before);
  const fresh = spawnSync(process.execPath, [cli, "query", dir, "files", "src", "--fresh", "--out", out], { env: ro, encoding: "utf8" });
  assert.equal(fresh.status, 2);
  assert.match(fresh.stderr, /READ_ONLY/);
  assert.deepEqual(snapshot(dir), before);
});

test("timeout, disconnect and close kill the child and everything it started", { skip }, async (t) => {
  const pids = (e: Env) => { const l = logs(e); return { parent: l[0].pid as number, kid: l.find((x) => x.childPid)?.childPid as number }; };
  const gone = async (e: Env) => { assert.ok(await until(() => logs(e).some((x) => x.childPid))); const p = pids(e); assert.ok(alive(p.kid)); return p; };
  const dead = async (p: { parent: number; kid: number }, what: string) => {
    assert.ok(await until(() => !alive(p.parent), 2500), `${what}: child survived`);
    assert.ok(await until(() => !alive(p.kid), 2500), `${what}: grandchild survived`);
  };
  // timeout
  const a = await boot(t);
  process.env.REPOLADDER_ASK_TIMEOUT_MS = "600";
  a.extra.FAKE_CLAUDE_MODE = "grandchild";
  const pa = call(a.s, "POST", "/api/ask", { body: q("hi") });
  const ids = await gone(a);
  assert.match((await pa).body, /TIMEOUT/);
  await dead(ids, "timeout");
  // disconnect
  const b = await boot(t);
  b.extra.FAKE_CLAUDE_MODE = "grandchild";
  const req = request({ host: "127.0.0.1", port: b.s.port, path: "/api/ask", method: "POST", headers: { host: `127.0.0.1:${b.s.port}`, "x-repoladder-token": b.s.token, "content-type": "application/json" } }, (res) => res.on("data", () => {}));
  req.on("error", () => {});
  req.end(q("hi"));
  const idb = await gone(b);
  req.destroy();
  await dead(idb, "disconnect");
  // close
  const c = await boot(t);
  c.extra.FAKE_CLAUDE_MODE = "grandchild";
  delete process.env.REPOLADDER_ASK_TIMEOUT_MS;
  const pc = call(c.s, "POST", "/api/ask", { body: q("hi") }).catch(() => undefined);
  const idc = await gone(c);
  await c.s.close();
  await dead(idc, "close");
  await pc;
});

test("tool-call cap kills the whole tree", { skip }, async (t) => {
  const e = await boot(t);
  e.extra.FAKE_CLAUDE_MODE = "manytools";
  assert.match((await call(e.s, "POST", "/api/ask", { body: q("hi") })).body, /TOO_MANY_STEPS/);
  assert.ok(await until(() => !alive(logs(e)[0].pid), 2500));
});

test("a throwing route returns a generic 500 with no internals", { skip }, async (t) => {
  const s = await startServer({ page: () => "x", ask: false, routes: { "GET /api/boom": () => { throw new Error("secret detail at /Users/x/file.ts:1"); } } });
  t.after(() => s.close());
  const r = await call(s, "GET", "/api/boom");
  assert.equal(r.status, 500);
  assert.deepEqual(JSON.parse(r.body), { error: { code: "INTERNAL", message: "Something went wrong inside repoladder serve." } });
  assert.doesNotMatch(r.body, /secret detail|\/Users|at /);
});

test("the serve process never logs the question, and the token only in SERVE_OK", { skip }, async () => {
  const out = mkdtempSync(join(tmpdir(), "rl-quiet-"));
  const marker = "MARKER-" + Math.random().toString(36).slice(2);
  const child = spawn(process.execPath, [cli, "serve", repo, "--no-open", "--out", out], { env: { ...process.env, REPOLADDER_NO_USAGE: "1", REPOLADDER_CLAUDE_BIN: fake } });
  let so = "", se = "";
  child.stderr!.on("data", (d) => (se += d));
  const m = await new Promise<RegExpMatchArray>((resolve, reject) => {
    child.stdout!.on("data", (d) => { so += d; const x = so.match(/SERVE_OK http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/); if (x) resolve(x); });
    child.on("exit", (c) => reject(new Error(`exited ${c}: ${se}`)));
  });
  const s = { port: Number(m[1]), token: m[2] } as Running;
  const r = await call(s, "POST", "/api/ask", { body: q(marker) });
  assert.equal(r.status, 200);
  await call(s, "POST", "/api/ask", { body: "not json " + marker });
  await new Promise<void>((res) => { child.on("exit", () => res()); child.kill("SIGINT"); });
  for (const text of [so, se]) assert.ok(!text.includes(marker), "the question reached the logs");
  assert.equal(so.split(s.token).length - 1, 1, "the token appears once, in SERVE_OK");
  assert.ok(!se.includes(s.token));
});

test("docs/serve-security.md only names tests that exist", () => {
  const doc = readFileSync(join(root, "docs/serve-security.md"), "utf8");
  const paths = [...doc.matchAll(/`(test\/[A-Za-z0-9_./-]+)`/g)].map((x) => x[1]);
  assert.ok(paths.length >= 5);
  for (const p of paths) assert.ok(existsSync(join(root, p)), `docs/serve-security.md names ${p}, which does not exist`);
});
