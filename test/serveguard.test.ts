import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize, hostAllowed, newToken, remoteAllowed, tokenOk } from "../src/serve/guard.ts";

const P = 4321;
const T = "a".repeat(64);

test("hostAllowed accepts only the bound port on 127.0.0.1 or localhost", () => {
  for (const h of [`127.0.0.1:${P}`, `localhost:${P}`, `LOCALHOST:${P}`]) assert.equal(hostAllowed(h, P), true, h);
  for (const h of ["evil.example", `127.0.0.1:${P + 1}`, `127.0.0.1.evil.example:${P}`, `[::1]:${P}`, "", "localhost", undefined]) {
    assert.equal(hostAllowed(h, P), false, String(h));
  }
});

test("remoteAllowed accepts loopback addresses only", () => {
  for (const a of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) assert.equal(remoteAllowed(a), true, a);
  for (const a of ["10.0.0.5", "192.168.1.2", "::ffff:10.0.0.5", "", undefined]) assert.equal(remoteAllowed(a), false, String(a));
});

test("tokenOk compares in constant time and refuses empty values", () => {
  assert.equal(tokenOk(T, T), true);
  assert.equal(tokenOk(T.slice(0, -1) + "b", T), false);
  assert.equal(tokenOk(T + "a", T), false);
  assert.equal(tokenOk("", T), false);
  assert.equal(tokenOk(undefined, T), false);
});

test("newToken is 64 hex chars and differs per call", () => {
  const a = newToken(), b = newToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

const req = (o: Partial<Parameters<typeof authorize>[0]> & { token?: string; q?: string }) => ({
  method: o.method ?? "GET",
  path: o.path ?? "/",
  query: new URLSearchParams(o.q ?? ""),
  headers: { host: `127.0.0.1:${P}`, ...(o.token ? { "x-repoladder-token": o.token } : {}), ...(o.headers ?? {}) },
  remoteAddress: "remoteAddress" in o ? o.remoteAddress : "127.0.0.1",
});
const run = (o: Parameters<typeof req>[0]) => authorize(req(o), { port: P, token: T });

test("authorize checks address, then Host, then token", () => {
  assert.deepEqual(run({ token: T }), { ok: true });
  assert.deepEqual(run({ q: `t=${T}` }), { ok: true });
  assert.equal((run({ remoteAddress: "10.0.0.5", token: T }) as { status: number }).status, 403);
  assert.equal((run({ headers: { host: "evil.example" }, token: T }) as { status: number }).status, 403);
  assert.equal((run({ remoteAddress: "10.0.0.5", headers: { host: "evil.example" } }) as { status: number }).status, 403);
  assert.equal((run({}) as { status: number }).status, 401);
  assert.equal((run({ path: "/nope" }) as { status: number }).status, 401);
  assert.equal((run({ token: "x" }) as { status: number }).status, 401);
});

test("the query token is refused off GET /", () => {
  assert.equal((run({ path: "/api/x", q: `t=${T}` }) as { status: number }).status, 401);
  assert.equal((run({ method: "POST", q: `t=${T}` }) as { status: number }).status, 401);
  assert.deepEqual(run({ path: "/api/x", token: T }), { ok: true });
});
