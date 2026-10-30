import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { fileGraph } from "../src/model/fgraph.ts";
import { resolveFlows } from "../src/model/flows.ts";
import { drawsEdge } from "../src/model/draws.ts";
import { composeTour, findChains } from "../src/model/compose.ts";
import { tourGraph } from "../src/model/chaintours.ts";
import { deriveTours } from "../src/model/derivedtours.ts";
import { tourStepIssues } from "../src/model/coverage.ts";
import { auditStep, litMarks, shownArrows } from "../src/viewer/tourstep.ts";

const src = (f: string) => readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8");
const step = (edges: [string, string][]) => ({ board: "b", stop: "default", lit: { boxes: edges.flat(), edges }, caption: "" });

test("the tour player draws nothing of its own (#394)", () => {
  assert.ok(!existsSync(new URL("../src/viewer/tourwire.ts", import.meta.url)));
  assert.doesNotMatch(src("styles.css"), /tour-tmp/);
  for (const f of ["tour.ts", "travel.ts", "tourstep.ts"]) {
    assert.doesNotMatch(src(f), /createElementNS|drawTourWire|clearTourWire|tour-tmp/, f);
  }
});

test("auditStep splits a step's edges into drawn, hidden and invented, forward only", () => {
  const real = ["a>b", "c>d"];
  assert.deepEqual(auditStep(step([["a", "b"]]), real, ["a>b"]), { drawn: [["a", "b"]], hidden: [], invented: [] });
  assert.deepEqual(auditStep(step([["c", "d"]]), real, ["a>b"]), { drawn: [], hidden: [["c", "d"]], invented: [] }, "real but minor");
  assert.deepEqual(auditStep(step([["x", "y"]]), real, ["a>b"]), { drawn: [], hidden: [], invented: [["x", "y"]] }, "fabricated");
  // only b>a is real and drawn: the step a>b is never drawn
  assert.deepEqual(auditStep(step([["a", "b"]]), ["b>a"], ["b>a"]), { drawn: [], hidden: [], invented: [["a", "b"]] });
  assert.deepEqual(auditStep(step([["a", "b"]]), ["a>b", "b>a"], ["b>a"]), { drawn: [], hidden: [["a", "b"]], invented: [] });
});

test("a reverse-only board lights no arrow for a forward step", () => {
  const s = step([["a", "b"]]);
  assert.deepEqual(shownArrows(s, ["n:a", "n:b", "e:a>b"]), [{ key: "a>b" }]);
  assert.deepEqual(shownArrows(s, ["n:a", "n:b", "e:b>a"]), []);
  assert.equal(litMarks(s, ["n:a", "e:b>a"]).get("e:b>a"), "off");
});

test("every derived tour step on test/fixtures/tourapp is drawn on its board at its stop", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/tourapp", import.meta.url)));
  const g = defaultGrouping(facts), a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  const m = buildModel(facts, g, a.leafOf);
  m.flows = resolveFlows(g, m, facts).flows;
  const tours = deriveTours(m, facts);
  assert.ok(tours.length > 0);
  // the build-time lint (#452) holds the same invariant, from the model alone
  assert.deepEqual(tourStepIssues({ ...m, derivedTours: tours }), []);
  for (const t of tours) for (const s of t.steps) {
    const board = m.boards[s.board], real = board.edges.map((e) => `${e.a}>${e.b}`), drawn = board.edges.filter((e) => e.major).map((e) => `${e.a}>${e.b}`);
    const r = auditStep(s, real, drawn);
    assert.deepEqual([r.hidden, r.invented], [[], []], `${t.title}: ${s.board}`);
    // the same rule tours.ts and compose.ts place by: a major arrow between two boxes
    for (const [x, y] of s.lit?.edges ?? []) assert.ok(drawsEdge(board, x, y), `${t.title}: ${x} -> ${y} on ${s.board}`);
  }
});

test("every chain-tour step on test/fixtures/tourapp is drawn as an arrow on its board", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/tourapp", import.meta.url)));
  const g = defaultGrouping(facts), a = assign(g, facts);
  const m = buildModel(facts, g, a.leafOf);
  m.fgraph = fileGraph(facts, a.leafOf);
  const tg = tourGraph(m);
  let steps = 0;
  for (const from of tg.paths) for (const chain of findChains(tg, from, undefined, { max: 3 })) {
    for (const s of composeTour(tg, chain)) {
      steps++;
      const board = tg.boards[s.board];
      // above Default a cut draws every rolled-up arrow, so the board's own edges are checked at Default only
      if (s.stop === "default") for (const [x, y] of s.lit.edges) assert.ok(drawsEdge(board, x, y), `${chain.join(" > ")}: ${x} -> ${y} on ${s.board}`);
    }
  }
  assert.ok(steps > 0);
});
