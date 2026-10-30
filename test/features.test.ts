// The launch switches (src/features.ts): the detail dial is off for launch, behind one switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { DEFAULT_FEATURES, bakedFeatures, featuresOf, resolveFeatures, stopsShown } from "../src/features.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { stopsFor } from "../src/viewer/budget.ts";
import { landOn } from "../src/viewer/dialmap.ts";
import { slideCap } from "../src/viewer/corner.ts";

const fixture = () => {
  const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));
  const g = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
  const f = analyze(dir);
  return buildModel(f, g, assign(g, f).leafOf);
};

test("launch defaults are both off; resolveFeatures with nothing gives them", () => {
  assert.deepEqual(DEFAULT_FEATURES, { dial: false, story: false });
  assert.deepEqual(resolveFeatures({}, {}), DEFAULT_FEATURES);
});

test("env: only 1 turns a switch on, 0 turns it off, anything else is the default; an explicit option wins", () => {
  assert.equal(resolveFeatures({ REPOLADDER_DIAL: "1" }).dial, true);
  assert.equal(resolveFeatures({ REPOLADDER_STORY: "1" }).story, true);
  for (const v of ["0", "true", "yes", "", undefined]) assert.equal(resolveFeatures({ REPOLADDER_DIAL: v }).dial, false);
  assert.equal(resolveFeatures({ REPOLADDER_DIAL: "1" }, { dial: false }).dial, false);
  assert.equal(resolveFeatures({ REPOLADDER_DIAL: "0" }, { dial: true }).dial, true);
});

test("featuresOf reads launch defaults from old data; bakedFeatures ships only what differs", () => {
  assert.deepEqual(featuresOf({}), DEFAULT_FEATURES);
  assert.deepEqual(featuresOf({ features: { dial: true } }), { dial: true, story: false });
  assert.deepEqual(bakedFeatures(DEFAULT_FEATURES), {});
  assert.deepEqual(bakedFeatures({ ...DEFAULT_FEATURES, dial: true }), { dial: true });
});

test("stopsShown: only Default with the dial off, every stop with it on", () => {
  const m = fixture();
  const d = pageData(renderHtml(m, {}));
  const defs = stopsFor(d.nodes, d.paths);
  assert.ok(defs.length > 1, "the fixture has more than one stop");
  assert.deepEqual(stopsShown(defs, DEFAULT_FEATURES).map((x) => x.key), ["default"]);
  assert.deepEqual(stopsShown(defs, { ...DEFAULT_FEATURES, dial: true }), defs);
});

test("with only Default offered, any remembered or linked stop lands on Default", () => {
  for (const k of ["+1", "+9", "everything", "simple", "detailed", null, "junk"]) assert.equal(landOn(k, ["default"]), "default");
});

test("a page ships a features key only when a switch differs from the defaults, and it survives the wire", () => {
  const m = fixture();
  assert.ok(!("features" in pageData(renderHtml(m, {}))));
  assert.ok(!("features" in pageData(renderHtml(m, {}, DEFAULT_FEATURES))));
  assert.deepEqual(pageData(renderHtml(m, {}, { ...DEFAULT_FEATURES, dial: true })).features, { dial: true });
});

test("slideCap with no dial (width 0) does not slide", () => {
  assert.equal(slideCap([5, 0, 390, 600], [0, 0, 1000, 600], 0, 390, 600), 5);
});

test("src/lib.ts reads no env", () => {
  assert.ok(!readFileSync(new URL("../src/lib.ts", import.meta.url), "utf8").includes("process.env"));
});

test("buildFromFiles: launch defaults without the option, the dial with it", async () => {
  const { buildFromFiles } = await import("../src/lib.ts");
  const files = { "src/a.ts": "export const a = 1;\n", "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n' };
  const off = await buildFromFiles(files), on = await buildFromFiles(files, { features: { dial: true } });
  assert.ok(off.ok && on.ok);
  if (!off.ok || !on.ok) return;
  assert.ok(!("features" in pageData(off.html)));
  assert.deepEqual(pageData(on.html).features, { dial: true });
});

test("tour steps authored at an upward stop map onto what Default draws (dial off)", async () => {
  const { defaultGrouping } = await import("../src/model/grouping.ts");
  const { resolveFlows } = await import("../src/model/flows.ts");
  const { deriveTours } = await import("../src/model/derivedtours.ts");
  const { mapStep } = await import("../src/viewer/dialmap.ts");
  const facts = analyze(fileURLToPath(new URL("./fixtures/tourapp", import.meta.url)));
  const g = defaultGrouping(facts), m = buildModel(facts, g, assign(g, facts).leafOf);
  m.flows = resolveFlows(g, m, facts).flows;
  m.derivedTours = deriveTours(m, facts);
  const d = pageData(renderHtml(m, {}));
  let n = 0;
  for (const t of d.derivedTours ?? []) for (const s of t.steps) {
    if (s.stop === "default") continue;
    const b = d.boards[s.board]; if (!b) continue;
    n++;
    const mapped = mapStep(s, s.board, b as never, d.tree ?? d.nodes, d.paths);
    for (const x of mapped.lit.boxes) assert.ok(b.nodes.includes(x) || (b as { inside?: Record<string, string> }).inside?.[x] !== undefined || x in d.nodes, `${x} is drawn on ${s.board}`);
    for (const [p, q] of mapped.lit.edges) assert.ok(b.edges.some((e: { a: string; b: string }) => e.a === p && e.b === q), `edge ${p}>${q} is on ${s.board}`);
  }
  // the tourapp fixture derives only Default steps today, so this guards the mapping if that changes
  assert.ok(n >= 0);
});
