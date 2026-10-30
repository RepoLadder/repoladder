// #452: every connection is an arrow on some board at the Default dial, and every tour step lands on a
// board that draws its edge. The wrapper over drawn.ts (#449) and the tour lint, plus the fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { lintReport } from "../src/build/budget.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { connectionCoverage, coverageFails, coverageLines, coverageOf, describeCoverage, tourStepIssues, type Coverage } from "../src/model/coverage.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { modelOf as pipelineModel } from "../src/build/pipeline.ts";
import { resolveTours } from "../src/model/tours.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { Grouping, type Facts } from "../src/model/schema.ts";
import { auditStep } from "../src/viewer/tourstep.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const modelOf = (name: string) => {
  const facts = analyze(fixtures + name);
  const g = defaultGrouping(facts), a = assign(g, facts);
  return { facts, model: buildModel(facts, g, a.leafOf) };
};
// the build's model, with derived tours (and the grouping's tours, when it has any)
const builtModel = (name: string) => {
  const facts = analyze(fixtures + name);
  return { facts, model: pipelineModel(facts, defaultGrouping(facts), { read: () => null, usingDefault: true, warn: false, log: () => {} }) };
};

// Known failures are todo, with what fixes them. None: #449 and #450 draw every connection.
const KNOWN: Record<string, string> = {};

for (const name of readdirSync(fixtures).sort()) {
  test(`coverage: fixture ${name} draws every connection and every tour step`, { todo: KNOWN[name] }, () => {
    const { facts, model } = builtModel(name);
    const c = coverageOf(model, facts);
    assert.deepEqual(c.undrawn.map((u) => `${u.from} -> ${u.to}`), []);
    assert.deepEqual(c.tourSteps, []);
    assert.equal(c.drawn, c.total);
    assert.equal(c.usesChecked, true);
  });
}

test("coverage: a connection whose arrows are all minor is undrawn, and the check bites", () => {
  const { facts, model } = modelOf("tourapp");
  const before = connectionCoverage(model, facts);
  assert.ok(before.total > 0 && before.undrawn.length === 0);
  const m: Model = JSON.parse(JSON.stringify(model));
  for (const b of Object.values(m.boards)) for (const e of b.edges) e.major = false;
  const c = connectionCoverage(m, facts);
  assert.equal(c.undrawn.length, c.total, "no board draws anything");
  assert.equal(c.drawn, 0);
  assert.ok(c.undrawn.every((u) => u.reason === "minor"));
  assert.ok(c.undrawn.some((u) => u.kind === "file"));
  assert.deepEqual([...c.undrawn].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to)), c.undrawn, "sorted by from, then to");
  assert.equal(coverageFails({ undrawn: c.undrawn, tourSteps: [] }), true);
});

test("coverage: a file named like a store id is still a file connection", () => {
  const { facts, model } = modelOf("tourapp");
  const m: Model = JSON.parse(JSON.stringify(model));
  for (const b of Object.values(m.boards)) for (const e of b.edges) e.major = false;
  assert.ok(connectionCoverage(m, facts).undrawn.every((u) => !/^(svc|store)-/.test(u.to) || u.kind !== "file"));
  assert.equal(connectionCoverage(m, facts).undrawn.filter((u) => u.kind === "file").every((u) => u.to in m.services === false), true);
});

test("coverage: a file in no leaf is counted as on no board, not as undrawn", () => {
  const { facts, model } = modelOf("tourapp");
  const odd = { ...facts, imports: [...facts.imports, { from: "nowhere/a.ts", to: "nowhere/b.ts", line: 1, kind: "static" as const }] } as Facts;
  const c = connectionCoverage(model, odd);
  assert.equal(c.noBoard, 1);
  assert.equal(c.undrawn.length, 0);
});

test("coverage: without facts only the file graph is checked", () => {
  const { facts, model } = modelOf("tourapp");
  const c = connectionCoverage(model);
  assert.equal(c.usesChecked, false);
  assert.equal(c.total, model.fgraph!.length);
  assert.ok(connectionCoverage(model, facts).total >= c.total);
});

test("coverage: service and store uses count, and a use with no drawn arrow is undrawn", () => {
  const { facts, model } = modelOf("stores");
  const uses = (facts.serviceUses?.length ?? 0) + (facts.storeUses?.length ?? 0);
  assert.ok(uses > 0, "the fixture has uses");
  const c = connectionCoverage(model, facts);
  assert.ok(c.total > connectionCoverage(model).total);
  const m: Model = JSON.parse(JSON.stringify(model));
  for (const b of Object.values(m.boards)) for (const e of b.edges) if (/^(svc|store)-/.test(e.b)) e.major = false;
  const after = connectionCoverage(m, facts);
  assert.ok(after.undrawn.length > 0 && after.undrawn.every((u) => u.kind !== "file"));
});

test("describeCoverage and coverageLines: the exact strings, capped", () => {
  assert.equal(describeCoverage({ total: 1595, undrawn: [] }), "1,595 connections, 0 undrawn");
  assert.equal(describeCoverage({ total: 7, undrawn: [{}] }), "7 connections, 1 undrawn");
  const u = (i: number) => ({ from: `a${i}.ts`, to: `b${i}.ts`, kind: "file" as const, reason: "minor" as const });
  const none: Coverage = { total: 10, drawn: 10, undrawn: [], noBoard: 0, usesChecked: true, tourSteps: [] };
  assert.deepEqual(coverageLines(none), ["CONNECTIONS 10 connections, 0 undrawn"]);
  const many: Coverage = { ...none, drawn: 0, undrawn: Array.from({ length: 25 }, (_, i) => u(i)), tourSteps: [{ tour: "t", step: 2, board: "root", edge: ["x", "y"] }] };
  const lines = coverageLines(many);
  assert.equal(lines[0], "CONNECTIONS 10 connections, 25 undrawn");
  assert.equal(lines.filter((l) => l.startsWith("UNDRAWN a")).length, 20);
  assert.ok(lines.includes("UNDRAWN a0.ts -> b0.ts"));
  assert.ok(lines.includes("UNDRAWN +5 more (lint.json has every one)"));
  assert.equal(lines.at(-1), "UNDRAWN_TOUR_STEP t/2 -> root");
});

test("lintReport carries coverage next to the existing keys", async () => {
  const { facts, model } = modelOf("tourapp");
  const r = lintReport(model, await layoutBoards(model), facts);
  assert.deepEqual(Object.keys(r), ["summary", "boards", "budget", "coverage"]);
  assert.deepEqual(Object.keys(r.coverage).sort(), ["drawn", "noBoard", "total", "tourSteps", "undrawn", "usesChecked"]);
  assert.equal(r.coverage.usesChecked, true);
  assert.equal(lintReport(model, await layoutBoards(model)).coverage.usesChecked, false);
});

test("tourStepIssues flags a step whose board only lists its edge, and skips other dial stops", () => {
  const board = (major: boolean) => ({ nodes: ["a", "b"], edges: [{ a: "a", b: "b", major }] });
  const tour = (s: object) => ({ id: "t", title: "T", source: "claude", steps: [{ text: "", caption: "", ...s }] });
  const model = (major: boolean, steps: object[]) => ({ boards: { root: board(major) }, tours: [tour(steps[0])], derivedTours: steps.slice(1).map(tour) }) as unknown as Model;
  const edge = { board: "root", edge: ["a", "b"] };
  assert.deepEqual(tourStepIssues(model(true, [edge])), []);
  assert.deepEqual(tourStepIssues(model(false, [edge])), [{ tour: "t", step: 0, board: "root", edge: ["a", "b"] }]);
  const chain = { board: "root", stop: "default", lit: { boxes: ["a", "b"], edges: [["a", "b"]] } };
  assert.equal(tourStepIssues(model(false, [edge, chain])).length, 2, "a steps tour and a derived one");
  assert.deepEqual(tourStepIssues(model(false, [{ ...chain, stop: "+1" }])), []);
  assert.equal(tourStepIssues(model(true, [{ board: "root", edge: ["a", "zzz"] }])).length, 1, "an end with no box");
  assert.deepEqual(tourStepIssues(model(false, [{ board: "root", node: "a" }])), []);
});

test("tourStepIssues agrees with auditStep on the deep fixture's steps and chain tours", () => {
  const dir = fixtures + "deep";
  const facts = analyze(dir);
  const base = JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8"));
  const MAIN = "src/app/shell/main.ts", SERVER = "src/api/server.ts";
  const g = Grouping.parse({ ...base, tours: [...base.tours, { id: "chain", title: "Chain", chain: [MAIN, SERVER] }] });
  const a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  const model = buildModel(facts, g, a.leafOf);
  const r = resolveTours(g, model);
  assert.deepEqual(r.errors, []);
  model.tours = r.tours;
  assert.ok(r.tours.length >= 2);
  const issues = tourStepIssues(model);
  const viaAudit: string[] = [];
  for (const t of r.tours) t.steps.forEach((s, i) => {
    if (s.stop && s.stop !== "default") return;
    const b = model.boards[s.board];
    const real = b.edges.map((e) => `${e.a}>${e.b}`), drawn = b.edges.filter((e) => e.major && b.nodes.includes(e.a) && b.nodes.includes(e.b)).map((e) => `${e.a}>${e.b}`);
    const lit = { boxes: [], edges: s.lit?.edges ?? (s.edge ? [s.edge] : []) };
    const x = auditStep({ board: s.board, stop: "default", caption: "", lit }, real, drawn);
    if (x.hidden.length || x.invented.length) viaAudit.push(`${t.id}/${i}`);
  });
  assert.deepEqual(issues.map((s) => `${s.tour}/${s.step}`), viaAudit);
});
