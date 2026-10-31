// The library entry (#362): parity with the CLI, purity, determinism, typed errors, memory source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, analyzeSource } from "../src/analyze/index.ts";
import { githubSource, gitSha, listAllPaths } from "../src/analyze/files.ts";
import { pageData } from "../src/build/filepack.ts";
import { memorySource } from "../src/analyze/source.ts";
import { workspaceGlobs } from "../src/analyze/packages.ts";
import { buildFromFiles, BuildError, VERSION, type BuildFromFilesOptions, type ProgressEvent } from "../src/lib.ts";

/** buildFromFiles on input that must build: narrows the result on `ok`. */
async function built(...a: Parameters<typeof buildFromFiles>) {
  const r = await buildFromFiles(...a);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r;
}

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = (n: string) => fileURLToPath(new URL(`fixtures/${n}`, import.meta.url));
const filesOf = (dir: string) => new Map(listAllPaths(dir).filter((p) => existsSync(join(dir, p))).map((p) => [p, readFileSync(join(dir, p), "utf8")] as [string, string]));
const metaOf = (dir: string): BuildFromFilesOptions => ({ repo: basename(dir), sha: gitSha(dir), github: githubSource(dir) });

function cliBuild(dir: string, ...args: string[]) {
  const tmp = mkdtempSync(join(tmpdir(), "cw-lib-"));
  execFileSync(process.execPath, [cli, "build", dir, "--fresh", ...args, "--out", tmp], { env: { ...process.env, DO_NOT_TRACK: "1" }, stdio: "pipe" });
  const json = (n: string) => JSON.parse(readFileSync(join(tmp, n), "utf8"));
  return { html: readFileSync(join(tmp, "diagram.html"), "utf8"), facts: json("facts.json"), model: json("model.json") };
}

test("analyzer parity: memory source equals disk for every fixture", () => {
  for (const name of readdirSync(fixture(""))) {
    const dir = fixture(name);
    const mem = analyzeSource(memorySource(filesOf(dir), { name: basename(dir) }), { sha: gitSha(dir), github: githubSource(dir) });
    assert.equal(JSON.stringify(mem), JSON.stringify(analyze(dir)), name);
  }
});

test("build parity: basic-app equals build --default", async () => {
  const dir = fixture("basic-app");
  const want = cliBuild(dir, "--default");
  const got = await built(filesOf(dir), metaOf(dir));
  assert.equal(got.html, want.html);
  assert.deepEqual(JSON.parse(JSON.stringify(got.facts)), want.facts);
  assert.deepEqual(JSON.parse(JSON.stringify(got.model)), want.model);
  assert.ok(got.html.startsWith('<meta charset="utf-8">'));
});

test("build parity: deep with its grouping equals build --grouping", async () => {
  const dir = fixture("deep");
  const gfile = join(dir, "grouping.json");
  const want = cliBuild(dir, "--grouping", gfile);
  const got = await built(filesOf(dir), { ...metaOf(dir), grouping: JSON.parse(readFileSync(gfile, "utf8")) });
  assert.equal(got.html, want.html);
  assert.deepEqual(JSON.parse(JSON.stringify(got.facts)), want.facts);
  assert.deepEqual(JSON.parse(JSON.stringify(got.model)), want.model);
});

test("pure: no cwd writes, no fetch, no exit", async () => {
  const cwd = process.cwd(), fetch0 = globalThis.fetch, exit0 = process.exit;
  const tmp = mkdtempSync(join(tmpdir(), "cw-pure-"));
  const calls: string[] = [];
  try {
    process.chdir(tmp);
    globalThis.fetch = (async (...a: unknown[]) => { calls.push(String(a[0])); throw new Error("no network"); }) as typeof fetch;
    process.exit = ((c?: number) => { throw new Error(`exit ${c}`); }) as typeof process.exit;
    await built(filesOf(fixture("basic-app")));
    await built(filesOf(fixture("basic-app")), { onProgress: () => {} });
  } finally {
    process.chdir(cwd); globalThis.fetch = fetch0; process.exit = exit0;
  }
  assert.deepEqual(readdirSync(tmp), []);
  assert.deepEqual(calls, []);
});

test("progress: html, facts and model are identical with and without onProgress", async () => {
  const files = filesOf(fixture("basic-app"));
  const a = await built(files), b = await built(files, { onProgress: () => {} });
  assert.equal(b.html, a.html);
  assert.deepEqual(JSON.parse(JSON.stringify(b.facts)), JSON.parse(JSON.stringify(a.facts)));
  assert.deepEqual(JSON.parse(JSON.stringify(b.model)), JSON.parse(JSON.stringify(a.model)));
});

test("progress: stages arrive in order", async () => {
  const ev: ProgressEvent[] = [];
  await built(filesOf(fixture("basic-app")), { onProgress: (e) => ev.push(e) });
  const started = ev.filter((e) => e.kind === "start").map((e) => e.stage);
  const order = ["read", "parse", "resolve", "model", "layout", "lint", "render"] as const;
  let at = -1;
  for (const s of order) { const i = started.indexOf(s, at + 1); assert.ok(i > at, `${s} starts in order`); at = i; }
  for (const s of new Set(started)) assert.ok(ev.some((e) => e.stage === s && e.kind === "done"), `${s} done`);
  for (const e of ev.filter((e) => e.kind === "tick")) {
    assert.equal(typeof e.done, "number"); assert.equal(typeof e.total, "number");
    assert.ok(e.done! <= e.total!);
    assert.equal(e.unit, e.stage === "layout" ? "boards" : "files");
  }
  assert.ok(!ev.some((e) => e.stage === "write" || e.kind === "note"));
});

test("progress: a custom grouping skips the grouping stage", async () => {
  const dir = fixture("deep");
  const grouping = JSON.parse(readFileSync(join(dir, "grouping.json"), "utf8"));
  const ev: ProgressEvent[] = [];
  await built(filesOf(dir), { ...metaOf(dir), grouping, onProgress: (e) => ev.push(e) });
  assert.ok(!ev.some((e) => e.stage === "grouping"));
  const def: ProgressEvent[] = [];
  await built(filesOf(dir), { onProgress: (e) => def.push(e) });
  assert.ok(def.some((e) => e.stage === "grouping"));
});

test("progress: a throwing callback does not fail the build", async () => {
  const files = filesOf(fixture("basic-app"));
  const a = await built(files);
  let calls = 0;
  const b = await built(files, { onProgress: () => { calls++; throw new Error("boom"); } });
  assert.ok(calls > 0);
  assert.equal(b.html, a.html);
  assert.deepEqual(JSON.parse(JSON.stringify(b.facts)), JSON.parse(JSON.stringify(a.facts)));
  assert.deepEqual(JSON.parse(JSON.stringify(b.model)), JSON.parse(JSON.stringify(a.model)));
});

test("pure: the library sources stay free of process, console, disk and CLI imports", () => {
  const bad = [/\bprocess\.(exit|env|argv|cwd|chdir)\b/, /\bconsole\.\w+\(/, /from\s+["'][^"']*\/(usage|cli|install)\.ts["']/, /\b(writeFileSync|mkdirSync)\b/];
  for (const f of ["../src/lib.ts", "../src/build/pipeline.ts"]) {
    const text = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
    for (const re of bad) assert.doesNotMatch(text, re, `${f} ${re}`);
  }
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL("../src/lib.ts", import.meta.url)), "utf8"), /node:fs/);
});

test("deterministic and independent of file order", async () => {
  const files = filesOf(fixture("basic-app"));
  const a = await built(files);
  const b = await built(files);
  const rev = await built(new Map([...files].reverse()));
  const obj = await built(Object.fromEntries(files));
  assert.equal(b.html, a.html);
  assert.equal(rev.html, a.html);
  assert.equal(obj.html, a.html);
});

test("typed errors", async () => {
  const code = (c: string) => (e: unknown) => e instanceof BuildError && e.code === c;
  const none = await buildFromFiles({ "README.md": "hi" });
  assert.ok(!none.ok && none.code === "NO_SOURCE_FILES");
  const files = filesOf(fixture("basic-app"));
  await assert.rejects(buildFromFiles(files, { grouping: { nope: 1 } as never }), code("INVALID_SCHEMA"));
  const deep = JSON.parse(readFileSync(join(fixture("deep"), "grouping.json"), "utf8"));
  await assert.rejects(buildFromFiles(files, { grouping: deep }), code("INVALID_GROUPING"));
});

test("memorySource normalises paths and answers the folder questions", () => {
  const s = memorySource({ "./a.ts": "a", "/b.ts": "b", "src\\c.ts": "c", "../x.ts": "x", "": "e" });
  assert.deepEqual(s.list(), ["a.ts", "b.ts", "src/c.ts"]);
  assert.ok(s.dirExists("") && s.dirExists("src") && !s.dirExists("lib"));
  assert.ok(s.exists("src/c.ts") && !s.exists("x.ts"));
  assert.equal(s.read("a.ts"), "a");
  assert.throws(() => s.read("nope.ts"));
});

test("workspaceGlobs still takes a folder path", () => {
  assert.ok(Array.isArray(workspaceGlobs(fixture("mono"))));
});

test("the result carries the engine version, which the page's generator tag repeats", async () => {
  const r = await buildFromFiles({ "src/index.ts": "export const a = 1;\n" });
  assert.ok(r.ok);
  assert.equal(r.engineVersion, VERSION);
  assert.ok(r.html.includes(`<meta name="generator" content="repoladder@${VERSION}">`));
});

test("profile (#521): default and full are identical and say full; hosted is recorded in the result, model and page", async () => {
  const files = filesOf(fixture("multi"));
  const def = await built(files, metaOf(fixture("multi"))), full = await built(files, { ...metaOf(fixture("multi")), profile: "full" });
  assert.equal(def.profile, "full");
  assert.equal(full.profile, "full");
  assert.ok(!("profile" in def.model));
  assert.equal(full.html, def.html);
  assert.deepEqual(full.model, def.model);
  const hosted = await built(files, { ...metaOf(fixture("multi")), profile: "hosted" });
  assert.equal(hosted.profile, "hosted");
  assert.equal(hosted.model.profile, "hosted");
  assert.equal((pageData(hosted.html) as { profile?: string }).profile, "hosted");
  assert.ok(!("profile" in pageData(def.html)));
});

test("profile (#521): an unknown profile throws INVALID_OPTIONS", async () => {
  await assert.rejects(buildFromFiles(filesOf(fixture("basic-app")), { profile: "x" as never }), (e: unknown) => e instanceof BuildError && e.code === "INVALID_OPTIONS" && e.status === 2 && /profile must be "full" or "hosted"/.test(e.message));
});
