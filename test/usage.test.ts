// The opt-in usage ping (#216): consent, the fixed payload, the opt-outs, and the counting worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { askUsageOnce, commitId, envOptOut, makePing, version, readConsent, sendPing, sizeRange, usageState, writeConsent, PING_URL } from "../src/usage.ts";
import worker, { parseRun, VERSION_RE, type D1 } from "../server/ping/worker.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = (n: string) => fileURLToPath(new URL(`fixtures/${n}`, import.meta.url));
const freshEnv = () => ({ REPOLADDER_CONFIG_DIR: mkdtempSync(join(tmpdir(), "cw-usage-")) });
const run = { ok: true, files: 120, ms: 4321, mode: "ai" as const };

test("the default URL is the deployed https endpoint", () => {
  assert.equal(PING_URL, "https://ping.repoladder.com/");
  assert.equal(new URL(PING_URL).protocol, "https:");
});

test("the version sent passes the worker's check", () => {
  assert.match(version(), VERSION_RE);
});

test("consent: ask until answered; yes makes a random id, no keeps none", () => {
  const env = freshEnv();
  assert.equal(usageState(env), "ask");
  const yes = writeConsent("yes", env);
  assert.match(yes.id!, /^[0-9a-f-]{36}$/);
  assert.equal(usageState(env), "on");
  assert.equal(writeConsent("yes", env).id, yes.id, "a second yes keeps the id");
  writeConsent("no", env);
  assert.equal(usageState(env), "off");
  assert.equal(readConsent(env)!.id, undefined);
  assert.notEqual(writeConsent("yes", env).id, yes.id, "yes after no is a new id");
});

test("DO_NOT_TRACK and REPOLADDER_NO_USAGE opt out, and mean never asking", () => {
  for (const [k, v, out] of [["DO_NOT_TRACK", "1", true], ["DO_NOT_TRACK", "true", true], ["DO_NOT_TRACK", "0", false], ["DO_NOT_TRACK", "", false], ["REPOLADDER_NO_USAGE", "yes", true]] as const)
    assert.equal(envOptOut({ [k]: v }), out, `${k}=${v}`);
  const env = { ...freshEnv(), DO_NOT_TRACK: "1" };
  assert.equal(usageState(env), "off");
  writeConsent("yes", env);
  assert.equal(usageState(env), "off");
});

test("size is a coarse range, never the count", () => {
  assert.deepEqual([0, 1, 49, 50, 199, 200, 999, 1000, 4999, 5000, 90000].map(sizeRange), ["0", "1-49", "1-49", "50-199", "50-199", "200-999", "200-999", "1000-4999", "1000-4999", "5000+", "5000+"]);
});

test("the payload is the fixed set of fields, and the worker accepts it", () => {
  const p = makePing({ ...run, ok: false, error: "INVALID_GROUPING" }, "3f6c0e1a-1b2c-4d3e-8f40-0123456789ab");
  assert.deepEqual(Object.keys(p).sort(), ["error", "id", "mode", "ok", "seconds", "size", "v", "version"]);
  assert.deepEqual({ ...p, version: "x" }, { v: 1, version: "x", ok: false, error: "INVALID_GROUPING", size: "50-199", seconds: 4, mode: "ai", id: "3f6c0e1a-1b2c-4d3e-8f40-0123456789ab" });
  assert.ok(parseRun(JSON.stringify(p)));
  assert.ok(parseRun(JSON.stringify(makePing(run, p.id))));
});

test("sendPing: only with a yes, a URL and no opt-out; posts the payload", async () => {
  const calls: { url: string; body: string }[] = [];
  const fake = (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return new Response(null, { status: 204 }); }) as typeof fetch;
  const env = freshEnv();
  assert.equal(await sendPing(run, { env, url: "https://p.test", fetch: fake }), false, "never asked");
  writeConsent("no", env);
  assert.equal(await sendPing(run, { env, url: "https://p.test", fetch: fake }), false, "said no");
  writeConsent("yes", env);
  assert.equal(await sendPing(run, { env, url: "", fetch: fake }), false, "no URL");
  assert.equal(await sendPing(run, { env: { ...env, DO_NOT_TRACK: "1" }, url: "https://p.test", fetch: fake }), false, "opted out by env");
  assert.equal(calls.length, 0);
  assert.equal(await sendPing(run, { env, url: "https://p.test", fetch: fake }), true);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).id, readConsent(env)!.id);
  assert.ok(parseRun(calls[0].body));
});

test("sendPing fails silently and quickly when the endpoint hangs or is unreachable", async () => {
  const env = freshEnv();
  writeConsent("yes", env);
  const hang = ((_: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  const t0 = performance.now();
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout doesn't hold the event loop open; a real socket does
  assert.equal(await sendPing(run, { env, url: "https://p.test", fetch: hang, timeoutMs: 50 }), false);
  clearTimeout(keepAlive);
  assert.ok(performance.now() - t0 < 1000);
  assert.equal(await sendPing(run, { env, url: "http://127.0.0.1:9", timeoutMs: 500 }), false);
});

test("worker: rejects anything but the exact payload", () => {
  const good = { v: 1, version: "0.1.0", ok: true, error: null, size: "1-49", seconds: 3, mode: "default", id: "3f6c0e1a-1b2c-4d3e-8f40-0123456789ab" };
  assert.deepEqual(parseRun(JSON.stringify(good)), { version: "0.1.0", ok: true, error: "", size: "1-49", seconds: 3, mode: "default", id: good.id });
  const bad = [
    { ...good, repo: "acme/secret" },
    { ...good, path: "/Users/me/src" },
    { ...good, v: 2 },
    { ...good, size: "123" },
    { ...good, mode: "x" },
    { ...good, ok: false, error: null },
    { ...good, ok: false, error: "ENOENT: /Users/me/x.ts" },
    { ...good, ok: true, error: "CRASH" },
    { ...good, seconds: -1 },
    { ...good, seconds: 1.5 },
    { ...good, id: "me@example.com" },
    { ...good, version: "x".repeat(40) },
  ];
  for (const b of bad) assert.equal(parseRun(JSON.stringify(b)), null, JSON.stringify(b));
  assert.equal(parseRun("not json"), null);
  assert.equal(parseRun("[]"), null);
  assert.equal(parseRun(" ".repeat(600) + JSON.stringify(good)), null);
});

test("worker: counts a valid POST and nothing else", async () => {
  const bound: unknown[][] = [];
  const db: D1 = {
    prepare: () => ({ bind: (...v: unknown[]) => (bound.push(v), v) }),
    batch: async (s) => s,
  };
  const post = (body: string, method = "POST") => worker.fetch(new Request("https://p.test", { method, body: method === "POST" ? body : undefined }), { DB: db });
  const id = "3f6c0e1a-1b2c-4d3e-8f40-0123456789ab";
  assert.equal((await post("", "GET")).status, 405);
  assert.equal((await post('{"v":1}')).status, 400);
  assert.equal(bound.length, 0);
  const res = await post(JSON.stringify({ v: 1, version: "0.1.0", ok: false, error: "CRASH", size: "5000+", seconds: 90, mode: "ai", id }));
  assert.equal(res.status, 204);
  assert.equal(bound.length, 2);
  assert.deepEqual(bound[0].slice(1), ["0.1.0", 0, "CRASH", "5000+", "ai", 90]);
  assert.deepEqual(bound[1].slice(0, 1), [id]);
});

const node = (args: string[], env: Record<string, string>) =>
  new Promise<{ code: number; stdout: string }>((res) =>
    execFile(process.execPath, [cli, ...args], { env: { ...process.env, DO_NOT_TRACK: "", REPOLADDER_NO_USAGE: "", ...env } }, (err, stdout) =>
      res({ code: err ? (err.code as number) : 0, stdout })));

test("cli: preflight asks once; usage yes/no stores the answer", async () => {
  const env = freshEnv();
  assert.match((await node(["preflight"], env)).stdout, /USAGE_ASK/);
  assert.match((await node(["usage"], env)).stdout, /USAGE_ASK/);
  assert.match((await node(["usage", "yes"], env)).stdout, /USAGE_ON/);
  assert.doesNotMatch((await node(["preflight"], env)).stdout, /USAGE_ASK/);
  assert.match((await node(["usage", "no"], env)).stdout, /USAGE_OFF/);
  assert.doesNotMatch((await node(["preflight"], { ...freshEnv(), DO_NOT_TRACK: "1" })).stdout, /USAGE_ASK/);
});

test("cli: a build sends one ping with no names, paths or code; a failed build sends its code", async () => {
  const got: string[] = [];
  const server = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push(b); res.writeHead(204).end(); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const env = { ...freshEnv(), REPOLADDER_PING_URL: url };
    const out = mkdtempSync(join(tmpdir(), "cw-usage-out-"));
    assert.equal((await node(["build", fixture("basic-app"), "--fresh", "--default", "--out", out], env)).code, 0);
    assert.equal(got.length, 0, "no consent, no ping");
    await node(["usage", "yes"], env);
    assert.equal((await node(["build", fixture("basic-app"), "--default", "--out", out], env)).code, 0);
    assert.equal(got.length, 1);
    const p = parseRun(got[0])!;
    assert.deepEqual({ ok: p.ok, error: p.error, size: p.size, mode: p.mode }, { ok: true, error: "", size: "1-49", mode: "default" });
    assert.doesNotMatch(got[0], /basic-app|fixtures|\/|\.ts/);
    writeFileSync(join(out, "grouping.json"), JSON.stringify({ version: 1, summary: "s", children: [{ id: "a", name: "A", summary: "s", files: ["nothing/**"] }] }));
    assert.equal((await node(["build", fixture("basic-app"), "--out", out], env)).code, 2);
    assert.equal(got.length, 2);
    assert.deepEqual({ ok: parseRun(got[1])!.ok, error: parseRun(got[1])!.error, mode: parseRun(got[1])!.mode }, { ok: false, error: "INVALID_GROUPING", mode: "ai" });
    assert.ok(JSON.parse(readFileSync(join(env.REPOLADDER_CONFIG_DIR, "usage.json"), "utf8")).id);
  } finally { server.close(); }
});

test("version is the short commit id (or dev), never undefined, and the worker accepts a ping built with it", () => {
  const v = version();
  assert.match(v, /^[0-9A-Za-z.+-]{1,24}$/);
  assert.ok(parseRun(JSON.stringify(makePing(run, "00000000-0000-4000-8000-000000000000"))));
});

test("commitId falls back to dev outside a git checkout", () => {
  assert.equal(commitId(mkdtempSync(join(tmpdir(), "rl-nogit-"))), "dev");
});

// the npm package's one-time question (#313)
const tty = (isTTY = true) => Object.assign(new PassThrough(), { isTTY });
const ask = async (env: Record<string, string | undefined>, send: (input: PassThrough) => void, opts: { inTTY?: boolean; outTTY?: boolean } = {}) => {
  const input = tty(opts.inTTY ?? true), prompt = new PassThrough();
  let text = "";
  prompt.on("data", (d) => (text += d));
  const p = askUsageOnce({ input, output: tty(opts.outTTY ?? true), prompt }, env);
  send(input);
  return { answer: await p, text };
};
const pinged = () => ({ ...freshEnv(), REPOLADDER_PING_URL: "http://127.0.0.1:9", DO_NOT_TRACK: "", REPOLADDER_NO_USAGE: "", CI: "" });

test("askUsageOnce: y/yes stores yes with a new id; the prompt names the question and PRIVACY.md", async () => {
  for (const reply of ["y\n", "YES\n"]) {
    const env = pinged();
    const { answer, text } = await ask(env, (i) => i.write(reply));
    assert.equal(answer, "yes");
    assert.equal(readConsent(env)!.consent, "yes");
    assert.match(readConsent(env)!.id!, /^[0-9a-f-]{36}$/);
    assert.match(text, /\[y\/N\]/);
    assert.match(text, /PRIVACY\.md/);
  }
});

test("askUsageOnce: Enter, anything else and EOF store no, with no id", async () => {
  for (const send of [(i: PassThrough) => i.write("\n"), (i: PassThrough) => i.write("maybe\n"), (i: PassThrough) => i.end()]) {
    const env = pinged();
    assert.equal((await ask(env, send)).answer, "no");
    assert.deepEqual([readConsent(env)!.consent, readConsent(env)!.id], ["no", undefined]);
  }
});

test("askUsageOnce: never asks off a terminal, in CI, with an answer or opt-out stored, or with no ping URL", async () => {
  const quiet = async (env: Record<string, string | undefined>, opts: { inTTY?: boolean; outTTY?: boolean } = {}) => {
    const r = await ask(env, (i) => i.write("y\n"), opts);
    assert.equal(r.answer, null);
    assert.equal(r.text, "", "nothing asked");
    assert.equal(readConsent(env), null, "nothing stored");
  };
  await quiet(pinged(), { inTTY: false });
  await quiet(pinged(), { outTTY: false });
  await quiet({ ...pinged(), CI: "1" });
  await quiet({ ...pinged(), REPOLADDER_NO_USAGE: "1" });
  await quiet({ ...pinged(), DO_NOT_TRACK: "1" });
  const answered = pinged();
  writeConsent("no", answered);
  assert.equal((await ask(answered, (i) => i.write("y\n"))).answer, null);
  assert.equal(readConsent(answered)!.consent, "no", "a stored answer is left alone");
  if (!PING_URL) await quiet({ ...freshEnv(), REPOLADDER_PING_URL: "", DO_NOT_TRACK: "", REPOLADDER_NO_USAGE: "", CI: "" }); // PING_URL ships empty until #306
});

test("a ping version like 0.12.3+a1b2c3d passes the worker's check", () => {
  const id = "3f6c5b6e-0b57-4c1c-9a39-6b1f0f6f5a11";
  assert.ok(parseRun(JSON.stringify({ ...makePing({ ok: true, files: 10, ms: 1000, mode: "default" }, id), version: "0.12.3+a1b2c3d" })));
});
