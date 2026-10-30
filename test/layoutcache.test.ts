import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { cacheKey, d2Pool } from "../src/build/d2pool.ts";
import { d2Source, layoutBoards } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const grouping = defaultGrouping(facts);
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);

test("layout: parallel, cached and uncached runs give the same layouts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-layout-"));
  try {
    const plain = await layoutBoards(model);
    const cold = await layoutBoards(model, { cacheDir: dir });
    const file = join(dir, "layout-cache.json");
    const saved = readFileSync(file, "utf8");
    const warm = await layoutBoards(model, { cacheDir: dir });
    assert.equal(JSON.stringify(cold), JSON.stringify(plain));
    assert.equal(JSON.stringify(warm), JSON.stringify(plain));
    assert.deepEqual(Object.keys(plain), Object.keys(model.boards).sort());
    // an unchanged re-run rewrites nothing
    assert.equal(readFileSync(file, "utf8"), saved);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("layout cache: hits skip D2, keys follow source and engine, unused entries are pruned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-cache-"));
  try {
    const src = d2Source(model, "root");
    const a = d2Pool({ cacheDir: dir, size: 1 });
    const first = await a.compile(src, "elk");
    await a.compile(src, "dagre");
    await a.close();
    assert.deepEqual(a.stats, { hits: 0, misses: 2 });

    const b = d2Pool({ cacheDir: dir, size: 1 });
    assert.deepEqual(await b.compile(src, "elk"), first);
    await b.close(); // never started a D2 worker; drops the dagre entry this run did not use
    assert.deepEqual(b.stats, { hits: 1, misses: 0 });
    const file = join(dir, "layout-cache.json");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).entries).length, 1);

    assert.notEqual(cacheKey("0.1.33", "elk", src), cacheKey("0.1.34", "elk", src));
    assert.notEqual(cacheKey("0.1.33", "elk", src), cacheKey("0.1.33", "dagre", src));
    assert.notEqual(cacheKey("0.1.33", "elk", src), cacheKey("0.1.33", "elk", src + " "));

    // a corrupt cache is ignored, not fatal
    writeFileSync(file, "{not json");
    const c = d2Pool({ cacheDir: dir, size: 1 });
    assert.deepEqual(await c.compile(src, "elk"), first);
    await c.close();
    assert.deepEqual(c.stats, { hits: 0, misses: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("d2Pool: two requests for the same source at once share one compile", async () => {
  const pool = d2Pool({ size: 1 });
  try {
    const src = "direction: down\na -> b\n";
    const [x, y] = await Promise.all([pool.compile(src, "elk"), pool.compile(src, "elk")]);
    assert.deepEqual(x, y);
    assert.deepEqual(pool.stats, { hits: 1, misses: 1 });
  } finally {
    await pool.close();
  }
});

test("layout cache: a read-only pool uses the file but leaves it as it was", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-ro-"));
  try {
    await layoutBoards(model, { cacheDir: dir });
    const file = join(dir, "layout-cache.json"), saved = readFileSync(file, "utf8");
    const split = { ...model, boards: { root: model.boards.root }, story: undefined };
    await layoutBoards(split, { cacheDir: dir, readOnlyCache: true });
    assert.equal(readFileSync(file, "utf8"), saved);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const srcs = ["a", "b", "c"].map((n) => `${n}: ${n}\n${n} -> z`);
const entriesOf = (file: string) => Object.keys(JSON.parse(readFileSync(file, "utf8")).entries);

test("incremental cache: saves every N new compiles before close, never prunes mid-build", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-inc-"));
  try {
    const file = join(dir, "layout-cache.json");
    const p = d2Pool({ cacheDir: dir, size: 1, saveEvery: 2 });
    await p.compile(srcs[0], "elk");
    assert.equal(existsSync(file), false);
    await p.compile(srcs[1], "elk");
    assert.equal(entriesOf(file).length, 2);
    await p.compile(srcs[2], "elk");
    assert.equal(entriesOf(file).length, 2);
    await p.close();
    assert.equal(entriesOf(file).length, 3);
    assert.deepEqual(readdirSync(dir), ["layout-cache.json"]);
    // a second pool with unused old entries: interim keeps them, close prunes
    const q = d2Pool({ cacheDir: dir, size: 1, saveEvery: 1 });
    await q.compile("new: n", "elk");
    assert.equal(entriesOf(file).length, 4);
    await q.close();
    assert.equal(entriesOf(file).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incremental cache: read-only pools never write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-inc-"));
  try {
    const p = d2Pool({ cacheDir: dir, size: 1, saveEvery: 1, readOnly: true });
    await p.compile(srcs[0], "elk");
    assert.equal(p.flush(), null);
    await p.close();
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incremental cache: time trigger and back-off follow the injected clock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-inc-"));
  try {
    const file = join(dir, "layout-cache.json");
    let t = 0;
    const p = d2Pool({ cacheDir: dir, size: 1, saveEvery: 1000, saveMs: 100, now: () => t });
    t = 99;
    await p.compile(srcs[0], "elk");
    assert.equal(existsSync(file), false);
    t = 100;
    await p.compile(srcs[1], "elk");
    assert.equal(entriesOf(file).length, 2);
    await p.close();
    // back-off: a save that took 50ms blocks another for 500ms. Clock reads, in order: create, maybeSave, interim start, interim end, then one per later compile
    rmSync(file);
    const reads = [0, 0, 0, 50, 100, 549, 550];
    let i = 0;
    const r = d2Pool({ cacheDir: dir, size: 1, saveEvery: 1, saveMs: 100000, now: () => reads[Math.min(i++, reads.length - 1)] });
    await r.compile("d1: 1", "elk");
    assert.equal(entriesOf(file).length, 1);
    await r.compile("d2: 2", "elk");
    await r.compile("d3: 3", "elk");
    assert.equal(entriesOf(file).length, 1);
    await r.compile("d4: 4", "elk");
    assert.equal(entriesOf(file).length, 4);
    await r.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incremental cache: stale tmp of a dead pid is removed, live pid and other files stay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-inc-"));
  try {
    const dead = join(dir, "layout-cache.json.2147483646.tmp"), own = join(dir, `layout-cache.json.${process.pid}.tmp`), other = join(dir, "layout-cache.json.x.tmp");
    for (const f of [dead, own, other]) writeFileSync(f, "x");
    const p = d2Pool({ cacheDir: dir, size: 1 });
    assert.equal(existsSync(dead), false);
    assert.equal(existsSync(own), true);
    assert.equal(existsSync(other), true);
    await p.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incremental cache: flush returns the count, null when nothing is new or no file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-inc-"));
  try {
    const p = d2Pool({ cacheDir: dir, size: 1 });
    assert.equal(p.flush(), null);
    await p.compile(srcs[0], "elk");
    assert.equal(p.flush(), 1);
    assert.equal(p.flush(), null);
    await p.close();
    const none = d2Pool({ size: 1 });
    await none.compile(srcs[0], "elk");
    assert.equal(none.flush(), null);
    await none.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
