// #521: the fidelity profile. `full` (default) draws every connection on a file board; `hosted`
// restores the budgeted rung (arrow budget, hubs, "used throughout") and relaxes the coverage check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { analyze } from "../src/analyze/index.ts";
import { drawingRungs } from "../src/model/drawn.ts";
import { connectionCoverage, coverageFails } from "../src/model/coverage.ts";
import { EDGE_BUDGET, splitOverBudget } from "../src/model/budgetsplit.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { resolveProfile } from "../src/model/profile.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Grouping } from "../src/model/schema.ts";
import { dense } from "./helpers/dense.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const modelOf = (facts: Parameters<typeof assign>[1], g: Grouping, profile?: "full" | "hosted") => buildModel(facts, g, assign(g, facts).leafOf, profile);

test("resolveProfile: default, both values, anything else throws", () => {
  assert.equal(resolveProfile(), "full");
  assert.equal(resolveProfile(null), "full");
  assert.equal(resolveProfile("full"), "full");
  assert.equal(resolveProfile("hosted"), "hosted");
  for (const bad of ["", "Hosted", "fast"]) assert.throws(() => resolveProfile(bad), RangeError);
});

test("a full model has no profile key and equals the default model", () => {
  const { facts, authored } = dense();
  const def = modelOf(facts, authored), full = modelOf(facts, authored, "full");
  assert.ok(!("profile" in def));
  assert.deepEqual(full, def);
  assert.equal(modelOf(facts, authored, "hosted").profile, "hosted");
});

test("hosted draws fewer arrows than full on a dense board, with hubs and throughout listed", () => {
  const { facts, authored } = dense();
  const full = modelOf(facts, authored, "full"), hosted = modelOf(facts, authored, "hosted");
  assert.ok(full.boards.app.edges.every((e) => e.major), "full draws every edge");
  const drawn = (m: typeof full) => m.boards.app.edges.filter((e) => e.major).length;
  assert.ok(drawn(hosted) < drawn(full));
  const b = hosted.boards.app;
  assert.deepEqual(b.hubs, ["f:app/f00.ts"]);
  const intoHub = b.edges.filter((e) => e.b === "f:app/f00.ts" && !e.calls);
  assert.ok(intoHub.length > 10 && intoHub.every((e) => e.hub));
  const hubDrawn = intoHub.filter((e) => e.major).length;
  assert.ok(hubDrawn * 2 < intoHub.length, `a hub's arrows are listed, bar orphan promotions (${hubDrawn} of ${intoHub.length} drawn)`);
  // Stripe and Firestore are each used by more than 3 files: listed, not drawn
  assert.deepEqual(b.throughout, ["store-firestore", "svc-stripe"]);
  assert.ok(!b.nodes.includes("svc-stripe"));
  // file-to-file arrows stay within the budget (no calls in this fixture), plus a few orphan promotions
  const boxes = b.nodes.filter((x) => x.startsWith("f:") || x === "+more").length;
  const fileArrows = b.edges.filter((e) => e.major && !e.uses && e.b.startsWith("f:")).length;
  assert.ok(fileArrows <= Math.max(8, Math.round(boxes * 1.5)) + 3, `${fileArrows} arrows`);
  // the part elsewhere keeps its arrows
  assert.ok(b.edges.some((e) => e.b === "lib" && e.major));
  // hosted leaves connections undrawn, full on the same leaf does not (small case aside)
  assert.ok(drawingRungs(facts, hosted).undrawn >= drawingRungs(facts, full).undrawn);
});

test("hosted: no more boards and no more drawn file arrows than full, on every fixture", () => {
  for (const name of readdirSync(fixtures)) {
    const facts = analyze(fixtures + name);
    const gf = defaultGrouping(facts), gh = defaultGrouping(facts, "hosted");
    const full = modelOf(facts, gf, "full"), hosted = modelOf(facts, gh, "hosted");
    assert.ok(Object.keys(hosted.boards).length <= Object.keys(full.boards).length, name);
    const arrows = (m: typeof full) => Object.values(m.boards).reduce((n, b) => n + b.edges.filter((e) => e.major).length, 0);
    assert.ok(arrows(hosted) <= arrows(full), name);
  }
});

test("hosted splitting ignores the file-arrow count (EDGE_BUDGET) on a dense leaf", () => {
  const { facts, authored } = dense();
  // an authored leaf of 14 files has about EDGE_BUDGET+ arrows in full and would be split by them
  const keep = new Set(facts.files.filter((f) => !f.path.startsWith("app/") || Number(f.path.slice(5, 7)) < 14).map((f) => f.path));
  const small = { ...facts, files: facts.files.filter((f) => keep.has(f.path)), imports: facts.imports.filter((i) => keep.has(i.from) && keep.has(i.to)), serviceUses: facts.serviceUses.filter((u) => keep.has(u.from)), storeUses: facts.storeUses.filter((u) => keep.has(u.file)) } as typeof facts;
  const full = modelOf(small, authored, "full");
  assert.ok(full.boards.app.edges.filter((e) => e.major).length > EDGE_BUDGET, "fixture is over the arrow budget in full");
  const cnt = (g: Grouping) => JSON.stringify(g).split('"files"').length;
  const hostedSplit = splitOverBudget(authored, small, [], { profile: "hosted" });
  assert.ok(cnt(hostedSplit) <= cnt(splitOverBudget(authored, small, [], { profile: "full" })));
});

test("coverageFails: true for full with an undrawn connection, false for hosted", () => {
  const { facts, authored } = dense();
  const m = modelOf(facts, authored, "full");
  const c = { ...connectionCoverage(m, facts), tourSteps: [] };
  assert.ok(c.undrawn.length > 0);
  assert.equal(coverageFails(c), true);
  assert.equal(coverageFails(c, "full"), true);
  assert.equal(coverageFails(c, "hosted"), false);
  assert.equal(coverageFails({ undrawn: [], tourSteps: [{ tour: "t", step: 1, board: "b" }] } as never, "hosted"), false);
});
