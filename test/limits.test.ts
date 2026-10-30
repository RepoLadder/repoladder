// Size and shape limits and the result codes for bad input (#364).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFromFiles, type BuildFailure, type InputCode } from "../src/lib.ts";
import { DEFAULT_LIMITS, INPUT_CODES, InputError, LIMIT_MESSAGES, NO_LIMITS, failureOf, resolveLimits, type InputDetail } from "../src/build/limits.ts";
import { analyze } from "../src/analyze/index.ts";
import { parseRun } from "../server/ping/worker.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = (n: string) => fileURLToPath(new URL(`fixtures/${n}`, import.meta.url));
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const ts = (n: number) => "export const x = 1;\n" + "//" + "a".repeat(Math.max(0, n - 22)) + "\n";

async function fails(files: Record<string, string> | Map<string, string>, limits: Parameters<typeof buildFromFiles>[1] = {}): Promise<BuildFailure> {
  let r: Awaited<ReturnType<typeof buildFromFiles>> | undefined;
  await assert.doesNotReject(async () => { r = await buildFromFiles(files, limits); });
  assert.ok(r && !r.ok, "expected a failure");
  return r as BuildFailure;
}

function check(r: BuildFailure, code: InputCode, detail: InputDetail) {
  assert.equal(r.ok, false);
  assert.equal(r.code, code);
  assert.equal(r.message, LIMIT_MESSAGES[code].message(detail));
  return r;
}

test("limits: the defaults and the code table", () => {
  assert.deepEqual(DEFAULT_LIMITS, { maxFiles: 5000, maxBytes: 50 * 1024 * 1024, maxFileBytes: 1024 * 1024 });
  assert.deepEqual(INPUT_CODES, ["EMPTY", "NO_SOURCE_FILES", "TOO_MANY_FILES", "TOO_MANY_BYTES", "FILE_TOO_LARGE", "UNREADABLE", "ANALYZE_FAILED"]);
  for (const c of INPUT_CODES) {
    assert.match(c, /^[A-Z_]{1,32}$/);
    assert.equal(typeof LIMIT_MESSAGES[c].status, "number");
  }
  assert.equal(LIMIT_MESSAGES.ANALYZE_FAILED.status, 1);
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL("../src/build/limits.ts", import.meta.url)), "utf8"), /from\s+["']node:|\bprocess\.(exit|env|argv|cwd)/);
});

test("limits: resolveLimits merges per field and rejects bad values", () => {
  assert.deepEqual(resolveLimits(), DEFAULT_LIMITS);
  assert.deepEqual(resolveLimits({ maxFiles: 2 }), { ...DEFAULT_LIMITS, maxFiles: 2 });
  assert.equal(resolveLimits({ maxBytes: Infinity }).maxBytes, Infinity);
  assert.throws(() => resolveLimits({ maxFiles: 0 }), RangeError);
  assert.throws(() => resolveLimits({ maxBytes: NaN }), RangeError);
  assert.throws(() => resolveLimits({ maxFileBytes: "9" as never }), RangeError);
});

test("library: EMPTY", async () => { check(await fails(new Map()), "EMPTY", {}); });

test("library: NO_SOURCE_FILES", async () => {
  check(await fails({ "README.md": "# hi", "logo.svg": "<svg/>" }), "NO_SOURCE_FILES", {});
});

test("library: TOO_MANY_FILES", async () => {
  const r = await fails({ "a.ts": ts(30), "b.ts": ts(30), "c.ts": ts(30) }, { limits: { maxFiles: 2 } });
  check(r, "TOO_MANY_FILES", { files: 3, limit: 2 });
  assert.deepEqual(r.detail, { files: 3, limit: 2 });
});

test("library: TOO_MANY_BYTES", async () => {
  const r = await fails({ "a.ts": ts(600), "b.ts": ts(600) }, { limits: { maxBytes: 1000 } });
  check(r, "TOO_MANY_BYTES", { bytes: 1200, limit: 1000 });
});

test("library: FILE_TOO_LARGE, with a repo-relative path", async () => {
  const r = await fails({ "src/big.ts": ts(2000), "ok.ts": ts(30) }, { limits: { maxFileBytes: 1000 } });
  check(r, "FILE_TOO_LARGE", { path: "src/big.ts", bytes: 2000, limit: 1000 });
  assert.equal(r.detail?.path, "src/big.ts");
});

test("library: UNREADABLE (a NUL byte)", async () => {
  const r = await fails({ "a.ts": "export const a = 1;\u0000" });
  check(r, "UNREADABLE", { path: "a.ts", error: "binary file" });
  assert.equal(r.detail?.path, "a.ts");
});

test("library: a stray NUL byte in a text file is dropped, not fatal (#405)", async () => {
  const r = await buildFromFiles({ "a.ts": ts(600) + "\nexport const v = { value: '\u0000env' };\n" });
  assert.equal(r.ok, true);
});

test("limits: the first failure wins, in sorted path order, and the same input gives the same result", async () => {
  const files = { "z.ts": ts(2000), "b.ts": ts(900), "a.ts": ts(900) };
  const limits = { maxFileBytes: 1000, maxBytes: 1500 };
  const a = await fails(files, { limits });
  assert.equal(a.code, "TOO_MANY_BYTES");
  const bigFirst = await fails({ "a.ts": ts(2000), "b.ts": ts(900), "c.ts": ts(900) }, { limits });
  assert.equal(bigFirst.code, "FILE_TOO_LARGE");
  assert.equal(bigFirst.detail?.path, "a.ts");
  assert.deepEqual(await fails(files, { limits }), a);
  assert.deepEqual(await fails(new Map(Object.entries(files).reverse()), { limits }), a);
});

test("limits: files are counted after the source filter, so docs and assets don't count", async () => {
  const r = await buildFromFiles({ "a.ts": ts(30), "README.md": "x".repeat(5000), "n.svg": "<svg/>" }, { limits: { maxFiles: 1, maxBytes: 100 } });
  assert.equal(r.ok, true);
});

test("failureOf: an InputError keeps its code, anything else is ANALYZE_FAILED", () => {
  const a = failureOf(new Error("boom"));
  assert.equal(a.code, "ANALYZE_FAILED");
  assert.equal(a.detail?.error, "boom");
  assert.equal(a.message, LIMIT_MESSAGES.ANALYZE_FAILED.message({ error: "boom" }));
  assert.equal(failureOf("str").detail?.error, "str");
  assert.equal(failureOf(new InputError("EMPTY")).code, "EMPTY");
});

test("library: an analyzer crash comes back as ANALYZE_FAILED", async () => {
  // A malformed `workspaces` field makes the analyzer throw on its own.
  const r = await buildFromFiles({ "package.json": JSON.stringify({ workspaces: { packages: 5 } }), "a.ts": ts(30) });
  if (!r.ok) {
    assert.equal(r.code, "ANALYZE_FAILED");
    assert.ok(r.detail?.error);
  } else {
    assert.ok(r.html, "the analyzer no longer throws on this input");
  }
});

test("analyze(root) without limits is unchanged: an empty folder gives Facts with no files", () => {
  assert.equal(analyze(tmp("cw-limits-")).files.length, 0);
  assert.throws(() => analyze(tmp("cw-limits-"), {}, NO_LIMITS), (e: unknown) => e instanceof InputError && e.code === "EMPTY");
});

const env = () => ({ ...process.env, REPOLADDER_CONFIG_DIR: tmp("cw-limits-cfg-") });
const spawn = (args: string[]) => spawnSync(process.execPath, [cli, ...args, "--out", tmp("cw-limits-out-")], { env: env(), encoding: "utf8" });

test("cli: a folder with files but no TS/JS keeps today's NO_SOURCE_FILES line (build, analyze, summary)", () => {
  const dir = tmp("cw-limits-");
  writeFileSync(join(dir, "README.md"), "# hi\n");
  const line = `NO_SOURCE_FILES: found no JavaScript or TypeScript source in ${dir} (tests, build output and node_modules are skipped). RepoLadder currently maps TS/JS repos only.`;
  for (const cmd of [["build", dir, "--default"], ["analyze", dir], ["summary", dir]]) {
    const r = spawn(cmd);
    assert.equal(r.status, 3, cmd[0]);
    assert.ok(r.stderr.split("\n").includes(line), `${cmd[0]}: ${r.stderr}`);
  }
});

test("a non-git folder holding only skipped dirs is NO_SOURCE_FILES, not EMPTY; no detail key is left undefined", async () => {
  const dir = tmp("cw-limits-");
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, "test", "a.ts"), "export const a = 1;\n");
  assert.throws(() => analyze(dir, {}, NO_LIMITS), (e: unknown) => e instanceof InputError && e.code === "NO_SOURCE_FILES");
  const r = await fails({});
  assert.equal(r.code, "EMPTY");
  assert.equal(r.detail, undefined);
});

test("a limit set to undefined falls back to its default", async () => {
  assert.equal(resolveLimits({ maxFiles: undefined }).maxFiles, DEFAULT_LIMITS.maxFiles);
});

test("cli: an empty folder prints EMPTY, a NUL-byte source file prints UNREADABLE", () => {
  const empty = tmp("cw-limits-");
  const r = spawn(["build", empty, "--default"]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /^EMPTY: /m);
  const bin = tmp("cw-limits-");
  writeFileSync(join(bin, "a.ts"), "export const a = 1;\u0000");
  const u = spawn(["build", bin, "--default"]);
  assert.equal(u.status, 3);
  assert.match(u.stderr, /^UNREADABLE: could not read a\.ts/m);
});

test("cli: no size limits, basic-app still builds", () => {
  const r = spawn(["build", fixture("basic-app"), "--default"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BUILD_OK/);
});

test("cli: a failed build pings its code", async () => {
  const got: string[] = [];
  const server = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push(b); res.writeHead(204).end(); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const e = { ...process.env, DO_NOT_TRACK: "", REPOLADDER_NO_USAGE: "", REPOLADDER_CONFIG_DIR: tmp("cw-limits-cfg-"), REPOLADDER_PING_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  const node = (args: string[]) => new Promise<number>((res) => execFile(process.execPath, [cli, ...args, "--out", tmp("cw-limits-out-")], { env: e }, (err) => res(err ? (err.code as number) : 0)));
  try {
    await node(["usage", "yes"]);
    const readme = tmp("cw-limits-");
    writeFileSync(join(readme, "README.md"), "hi");
    assert.equal(await node(["build", readme, "--default"]), 3);
    assert.equal(await node(["build", tmp("cw-limits-"), "--default"]), 3);
    mkdirSync(join(readme, "x"));
    assert.deepEqual(got.map((b) => parseRun(b)!.error), ["NO_SOURCE_FILES", "EMPTY"]);
  } finally { server.close(); }
});
