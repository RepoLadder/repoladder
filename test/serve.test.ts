import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:http";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "src/cli.ts");
const fixture = join(root, "test/fixtures/basic-app");
const env = { ...process.env, REPOLADDER_NO_USAGE: "1" };

type Srv = { child: ChildProcess; out: string; port: number; token: string; stdout: () => string; stderr: () => string };

function start(out: string, extra: string[] = []): Promise<Srv> {
  const child = spawn(process.execPath, [cli, "serve", fixture, "--no-open", "--out", out, ...extra], { env });
  let so = "", se = "";
  child.stderr!.on("data", (d) => (se += d));
  return new Promise((resolve, reject) => {
    child.stdout!.on("data", (d) => {
      so += d;
      const m = so.match(/SERVE_OK http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/);
      if (m) resolve({ child, out, port: Number(m[1]), token: m[2], stdout: () => so, stderr: () => se });
    });
    child.on("exit", (c) => reject(new Error(`serve exited ${c}: ${se}`)));
  });
}

const stop = (s: Srv) => new Promise<number | null>((res) => { s.child.removeAllListeners("exit"); s.child.on("exit", res); s.child.kill("SIGINT"); });

function get(s: Srv, path: string, o: { method?: string; headers?: Record<string, string>; host?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port: s.port, path, method: o.method ?? "GET", headers: { host: o.host ?? `127.0.0.1:${s.port}`, ...o.headers } }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    r.on("error", reject);
    r.end();
  });
}

test("serve: token, Host, loopback, headers and rebuild behaviour", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "rl-serve-"));
  const s = await start(out);
  t.after(() => s.child.kill("SIGKILL"));
  assert.match(s.stderr(), /NO_MAP:/);
  const built = readFileSync(join(out, "diagram.html"), "utf8");
  const h = { "x-repoladder-token": s.token };

  const page = await get(s, `/?t=${s.token}`);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes("<title>"));
  assert.equal(page.body, built);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.equal(page.headers["access-control-allow-origin"], undefined);

  assert.equal((await get(s, "/")).status, 401);
  assert.equal((await get(s, "/?t=x")).status, 401);
  assert.equal((await get(s, "/", { headers: { "x-repoladder-token": "x" } })).status, 401);
  assert.equal((await get(s, `/api/anything?t=${s.token}`)).status, 401);
  assert.equal((await get(s, "/", { headers: h })).status, 200);
  const nf = await get(s, "/nope", { headers: h });
  assert.equal(nf.status, 404);
  assert.equal(nf.headers["access-control-allow-origin"], undefined);
  assert.equal((await get(s, "/", { method: "POST", headers: h })).status, 405);
  assert.equal((await get(s, `/?t=${s.token}`, { host: "evil.example" })).status, 403);
  assert.equal((await get(s, `/?t=${s.token}`, { host: `localhost:${s.port}` })).status, 200);

  // odd request targets neither crash the server nor reach a route
  for (const path of ["//", "//x/y?t=" + s.token, "http://", "*"]) {
    const r = await get(s, path, { headers: h });
    assert.ok(r.status === 404 || r.status === 401, `${path} -> ${r.status}`);
  }
  assert.equal((await get(s, `/?t=${s.token}`)).status, 200, "still alive");

  const external = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal);
  if (external) {
    const refused = await new Promise<boolean>((res) => {
      const r = request({ host: external.address, port: s.port, path: "/" }, () => res(false));
      r.on("error", () => res(true));
      r.end();
    });
    assert.ok(refused, "must not accept connections on a non-loopback interface");
  }

  if (process.platform !== "win32") {
    const code = await stop(s);
    assert.equal(code, 0);
    assert.match(s.stdout().trim(), /SERVE_STOPPED$/);
  }
});

test("serve: an existing map is served untouched", async () => {
  const out = mkdtempSync(join(tmpdir(), "rl-serve-"));
  const a = await start(out);
  await stop(a);
  const file = join(out, "diagram.html");
  const mtime = statSync(file).mtimeMs;
  const b = await start(out);
  try {
    assert.doesNotMatch(b.stderr(), /NO_MAP/);
    assert.equal(statSync(file).mtimeMs, mtime);
  } finally { await stop(b); }
});

test("serve: bad and busy ports", async () => {
  const out = mkdtempSync(join(tmpdir(), "rl-serve-"));
  for (const p of ["70000", "abc"]) {
    const r = spawnSync(process.execPath, [cli, "serve", fixture, "--no-open", "--out", out, "--port", p], { env, encoding: "utf8" });
    assert.equal(r.status, 2, p);
    assert.match(r.stderr, /INVALID_OPTIONS/);
  }
  assert.ok(!existsSync(join(out, "diagram.html")), "validation runs before any build");
  const busy = createServer();
  await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
  const port = (busy.address() as { port: number }).port;
  try {
    const r = spawnSync(process.execPath, [cli, "serve", fixture, "--no-open", "--out", out, "--port", String(port)], { env, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /PORT_IN_USE/);
  } finally { busy.close(); }
});
