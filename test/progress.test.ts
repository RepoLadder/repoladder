// #428: progress lines for `build`: formats, throttle, stepSync/step, and the analyzer's events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { readSources } from "../src/analyze/input.ts";
import { NO_LIMITS } from "../src/build/limits.ts";
import { formatDuration, progressPrinter, step, stepSync, type ProgressEvent } from "../src/build/progress.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function rig() {
  let t = 0;
  const lines: string[] = [];
  const on = progressPrinter({ write: (l) => lines.push(l), now: () => t });
  return { lines, on, at: (ms: number) => { t = ms; } };
}

test("durations: 0.4s, 12s, 4m12s, 1h02m", () => {
  assert.equal(formatDuration(400), "0.4s");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(252_000), "4m12s");
  assert.equal(formatDuration(3_720_000), "1h02m");
});

test("start and done lines, with per-pass labels", () => {
  const r = rig();
  r.on({ stage: "read", kind: "start" });
  r.at(400);
  r.on({ stage: "read", kind: "done" });
  r.at(1000);
  r.on({ stage: "layout", kind: "start", pass: 1, passes: 3 });
  r.at(2_461_000);
  r.on({ stage: "layout", kind: "done", pass: 1, passes: 3 });
  r.on({ stage: "write", kind: "start" });
  assert.deepEqual(r.lines, [
    "[build] reading files… · 0.0s elapsed",
    "[build] reading files done in 0.4s · 0.4s elapsed",
    "[build] layout pass 1 of up to 3… · 1.0s elapsed",
    "[build] layout pass 1 of up to 3 done in 41m00s · 41m01s elapsed",
    "[build] writing files… · 41m01s elapsed",
  ]);
});

test("tick: thousands separators, percent, throttle", () => {
  const r = rig();
  const tick = (done: number) => r.on({ stage: "layout", kind: "tick", pass: 1, passes: 3, unit: "boards", done, total: 1200 });
  r.on({ stage: "layout", kind: "start", pass: 1, passes: 3 });
  r.at(1000); tick(500); // 41% but inside 5 s
  r.at(6000); tick(120); // 10% after 5 s: prints
  r.at(7000); tick(200); // 16%: under 10 points since the last print
  r.at(12_000); tick(340); // 28%: prints
  r.at(50_000); tick(341); // 30 s gap: prints at any percent
  assert.equal(r.lines.length, 4);
  assert.equal(r.lines[1], "[build] layout pass 1 of up to 3: 120/1,200 boards (10%) · 6.0s elapsed");
  assert.match(r.lines[2], /340\/1,200 boards \(28%\)/);
  assert.match(r.lines[3], /341\/1,200 boards \(28%\)/);
});

test("10000 ticks over 60 s print well under 50 lines; no total prints nothing", () => {
  const r = rig();
  r.on({ stage: "parse", kind: "start", unit: "files" });
  for (let i = 1; i <= 10_000; i++) { r.at(i * 6); r.on({ stage: "parse", kind: "tick", unit: "files", done: i, total: 10_000 }); }
  assert.ok(r.lines.length < 50, String(r.lines.length));
  const n = r.lines.length;
  r.on({ stage: "render", kind: "tick", done: 3 });
  r.on({ stage: "render", kind: "tick", done: 3, total: 0 });
  assert.equal(r.lines.length, n);
});

test("stepSync and step emit start then done, none on a throw, nothing with no callback", async () => {
  const ev: string[] = [];
  const on = (e: ProgressEvent) => ev.push(`${e.stage}:${e.kind}`);
  assert.equal(stepSync(on, { stage: "render" }, () => 7), 7);
  assert.equal(await step(on, { stage: "layout" }, async () => 8), 8);
  assert.deepEqual(ev, ["render:start", "render:done", "layout:start", "layout:done"]);
  ev.length = 0;
  assert.throws(() => stepSync(on, { stage: "write" }, () => { throw new Error("x"); }), /x/);
  await assert.rejects(step(on, { stage: "write" }, () => { throw new Error("y"); }), /y/);
  assert.deepEqual(ev, ["write:start", "write:start"]);
  assert.equal(stepSync(undefined, { stage: "write" }, () => 1), 1);
  assert.equal(await step(undefined, { stage: "write" }, () => 2), 2);
});

test("analyze emits read, parse and resolve once each and returns the same facts", () => {
  const ev: ProgressEvent[] = [];
  const a = analyze(fixture("basic-app"), {}, NO_LIMITS, (e) => ev.push(e));
  const b = analyze(fixture("basic-app"), {}, NO_LIMITS);
  assert.deepEqual(a, b);
  for (const s of ["read", "parse", "resolve"] as const) {
    assert.equal(ev.filter((e) => e.stage === s && e.kind === "start").length, 1, s);
    assert.equal(ev.filter((e) => e.stage === s && e.kind === "done").length, 1, s);
  }
  for (const s of ["read", "parse"] as const) {
    const ticks = ev.filter((e) => e.stage === s && e.kind === "tick");
    assert.equal(ticks.length, a.files.length, s);
    assert.ok(ticks.every((e) => e.total === a.files.length));
  }
  const c: ProgressEvent[] = [];
  analyze(fixture("basic-app"), {}, undefined, (e) => c.push(e));
  assert.equal(c.filter((e) => e.stage === "read" && e.kind === "tick").length, a.files.length);
});

test("readSources ticks in sorted order and still throws", () => {
  const seen: [number, number][] = [];
  readSources(["b.ts", "a.ts"], () => "x", NO_LIMITS, (d, t) => seen.push([d, t]));
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
  assert.throws(() => readSources(["a.ts"], () => null, NO_LIMITS, () => {}), /UNREADABLE|InputError/);
});
