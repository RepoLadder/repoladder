// #434: compact machine JSON, one default-grouping computation, memory numbers in TIMING lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { buildDiagram } from "../src/build/pipeline.ts";
import { d2Pool } from "../src/build/d2pool.ts";
import { defaultGrouping } from "../src/model/grouping.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const basic = fileURLToPath(new URL("./fixtures/basic-app", import.meta.url));

function build(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rl-large-"));
  const r = spawnSync(process.execPath, [cli, "build", basic, "--out", dir, "--default", "--quiet"], { encoding: "utf8", env: { ...process.env, REPOLADDER_NO_USAGE: "1", ...env } });
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  const files = Object.fromEntries(["facts.json", "model.json", "lint.json", "grouping.default.json"].map((f) => [f, read(f)]));
  rmSync(dir, { recursive: true, force: true });
  return { r, files };
}

test("facts, model and lint are written compact; the editable default grouping stays indented", () => {
  const { r, files } = build();
  assert.equal(r.status, 0, r.stderr);
  for (const f of ["facts.json", "model.json", "lint.json"]) {
    const text = files[f];
    assert.ok(text.endsWith("}\n"), f);
    assert.equal(text.trimEnd().split("\n").length, 1, f);
    assert.ok(!/^ /m.test(text), f);
    JSON.parse(text);
  }
  assert.ok(Object.keys(JSON.parse(files["lint.json"]).budget.byBoard).length > 0);
  assert.ok(/^ /m.test(files["grouping.default.json"]));
});

test("buildDiagram with a precomputed default grouping gives the same page", async () => {
  const facts = analyze(basic);
  const o = { facts, grouping: null, read: () => null, lane: false };
  const a = await buildDiagram(o);
  const b = await buildDiagram({ ...o, defaultGrouping: defaultGrouping(facts) });
  assert.equal(b.html, a.html);
});

test("TIMING lines carry rss and heap; without the env there are none", () => {
  const on = build({ REPOLADDER_TIMINGS: "1" });
  const lines = on.r.stderr.split("\n").filter((l) => l.startsWith("TIMING "));
  assert.ok(lines.length > 3);
  for (const l of lines) assert.match(l, / rss=\d+MB heap=\d+MB$/);
  const off = build({ REPOLADDER_TIMINGS: "" });
  assert.ok(!off.r.stderr.includes("TIMING"));
});

// A fake D2: compile resolves after a tick and tracks how many run at once.
function fake() {
  const made: { terminated: boolean }[] = [];
  let live = 0, peak = 0;
  const factory = () => {
    const d = {
      terminated: false,
      worker: { terminate: async () => { d.terminated = true; } },
      compile: async () => {
        peak = Math.max(peak, ++live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return { diagram: { shapes: [], connections: [] } };
      },
    };
    made.push(d);
    return d;
  };
  return { factory, made, peak: () => peak };
}

test("d2Pool creates instances on demand, capped at size, and closes exactly those", async () => {
  for (const [n, want] of [[1, 1], [3, 3], [10, 4]] as const) {
    const f = fake();
    const pool = d2Pool({ size: 4, factory: f.factory });
    await Promise.all(Array.from({ length: n }, (_, i) => pool.compile(`a${i}`, "dagre")));
    assert.equal(f.made.length, want, `${n} compiles`);
    assert.ok(f.peak() <= 4);
    await pool.close();
    assert.ok(f.made.every((d) => d.terminated));
  }
  const none = fake();
  const pool = d2Pool({ size: 4, factory: none.factory });
  await pool.close();
  assert.equal(none.made.length, 0);
});
