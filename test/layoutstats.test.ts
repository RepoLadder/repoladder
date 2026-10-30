import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addStats, dedupe, formatStats, newStats } from "../src/build/layoutstats.ts";

const at = (p: string) => JSON.stringify(new URL(p, import.meta.url).href);
const script = `
import { buildModel } from ${at("../src/model/rollup.ts")};
import { assign, defaultGrouping } from ${at("../src/model/grouping.ts")};
import { syntheticFacts } from ${at("../scripts/layoutbenchrepo.ts")};
import { layoutPasses } from ${at("../src/build/passes.ts")};
const f = syntheticFacts({ folders: 12 }), g = defaultGrouping(f);
await layoutPasses({ facts: f, grouping: g, splitting: false, lane: true, modelOf: (x) => buildModel(f, x, assign(x, f).leafOf) });
`;
// TIMINGS is read at import, so each case runs in its own process; NODE_OPTIONS from the runner is dropped
const run = (env: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-stats-")), file = join(dir, "run.ts");
  try {
    writeFileSync(file, script);
    const { NODE_OPTIONS: _, ...base } = process.env;
    return spawnSync(process.execPath, [file], { env: { ...base, REPOLADDER_TIMINGS: "", ...env }, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("timings on: the layout line carries the new fields and the counts agree", () => {
  const r = run({ REPOLADDER_TIMINGS: "1" });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stderr.split("\n").find((l) => l.startsWith("TIMING layout#0"))!;
  assert.ok(line, r.stderr);
  const tok = Object.fromEntries(line.split(" ").filter((t) => t.includes("=")).map((t) => t.split("=") as [string, string]));
  for (const k of ["boards", "reused", "compiles", "hits", "dir", "spread", "lane", "clearRetries", "laneSecond", "stopRung", "fullLadder", "d2Ms", "jsMs"]) assert.ok(k in tok, `${k} in ${line}`);
  const sum = (v: string) => v.split(",").reduce((a, p) => a + Number(p.split(":")[1] ?? 0), 0);
  assert.equal(sum(tok.dir), sum(tok.spread));
  assert.equal(sum(tok.dir), sum(tok.lane));
  assert.equal(sum(tok.stopRung) + Number(tok.fullLadder), Number(tok.boards)); // no store boards in this repo
});

test("timings off: no TIMING output", () => {
  const r = run({});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.includes("TIMING"), false);
});

test("formatStats: no spaces inside a token, and addStats sums", () => {
  const a = newStats();
  a.dir.right = 2; a.spread["1.4"] = 1; a.stopRung["0"] = 3; a.fullLadder = 1;
  const b = newStats();
  b.dir.right = 1; b.dir.down = 4; b.d2Ms = 5;
  addStats(a, b);
  assert.deepEqual(a.dir, { right: 3, down: 4 });
  for (const t of formatStats(a).split(" ")) assert.match(t, /^\w+=\S+$/);
  assert.match(formatStats(newStats()), /dir=- /);
});

test("dedupe keeps the first of equal candidates and counts the rest", () => {
  const seen = new Set<string>();
  const x = { n: [["a", 0, 0, 1, 1, 0]] }, y = { n: [["b", 0, 0, 1, 1, 0]] };
  const r1 = dedupe([x, structuredClone(x), y], seen);
  assert.deepEqual(r1.kept, [x, y]);
  assert.equal(r1.dropped, 1);
  const r2 = dedupe([structuredClone(y)], seen);
  assert.equal(r2.kept.length, 0);
  assert.equal(r2.dropped, 1);
});
