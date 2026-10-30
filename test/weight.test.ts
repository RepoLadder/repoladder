import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { boardSvg } from "../src/build/export.ts";
import { boxSizes, d2Source, namePx, pickLayout, subLabel, type BoardLayout } from "../src/build/layout.ts";
import { STACK_PAD, isStacked } from "../src/build/outline.ts";
import { cylPad } from "../src/build/cylgap.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { edgeWeight, linesLabel, partSub, weightClass } from "../src/viewer/weight.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const grouping = defaultGrouping(facts);
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);

test("weight: counts read as files and lines", () => {
  assert.equal(linesLabel(1), "1 line");
  assert.equal(linesLabel(640), "640 lines");
  assert.equal(linesLabel(6200), "6.2k lines");
  assert.equal(linesLabel(12000), "12k lines");
  assert.equal(linesLabel(128_400), "128k lines");
  assert.equal(partSub(38, 6234), "38 files · 6.2k lines");
  assert.equal(partSub(1, 53), "1 file · 53 lines");
});

test("weight: arrows are bucketed by imports + 3 × calls; service and data edges are not", () => {
  const e = (imports: number, calls: number, uses = 0) => ({ imports, calls, uses });
  assert.equal(edgeWeight(e(2, 3)), 11);
  assert.deepEqual([e(1, 0), e(4, 0), e(0, 2), e(5, 0), e(0, 7), e(20, 0), e(0, 30), e(80, 0)].map(weightClass), ["w1", "w1", "w2", "w2", "w3", "w3", "w4", "w4"]);
  assert.equal(weightClass(e(0, 0, 4)), "");
  assert.equal(weightClass({ ...e(0, 0, 4), reads: 4 }), "");
});

test("layout: boxes on a board share one size per kind, whatever their lines of code, and D2 gets it", () => {
  for (const [id, b] of Object.entries(model.boards)) {
    const size = boxSizes(model, id);
    // on a leaf's board, file boxes and context boxes are sized apart
    const leaf = !model.nodes[id]?.children.length, ctx = (n: string) => leaf && b.context.includes(n);
    const kinds = [b.nodes.filter((n) => !model.services[n] && !ctx(n)), b.nodes.filter(ctx), b.nodes.filter((n) => model.services[n] && !n.startsWith("store-")), b.nodes.filter((n) => n.startsWith("store-"))];
    for (const group of kinds) assert.equal(new Set(group.map((n) => size[n].join("x"))).size, Math.min(1, group.length), `${id}: ${group}`);
    const src = d2Source(model, id, "right", 2);
    // an openable box also reserves room for its stacked cards, and a cylinder room above and below (cylgap.ts)
    const pad = (n: string) => (isStacked(model, id, n) ? STACK_PAD : 0), cyl = (n: string) => cylPad(model, id, n, "right", 2, false);
    for (const n of b.nodes) assert.ok(src.includes(`{ width: ${Math.round((size[n][0] + pad(n)) * 2)}; height: ${Math.round((size[n][1] + pad(n) + cyl(n)) * 2)}`), n);
    const parts = b.nodes.filter((n) => model.nodes[n] && !b.context.includes(n) && !model.services[n]);
    for (const p of parts) assert.equal(subLabel(model, p, id), partSub(model.nodes[p].count, model.nodes[p].loc));
  }
  // parts with very different code volume still get the same box
  const root = model.boards.root, parts = root.nodes.filter((n) => model.nodes[n] && !model.services[n]);
  assert.ok(parts.length > 1 && new Set(parts.map((n) => model.nodes[n].loc)).size > 1);
});

test("layout: the candidate whose names read biggest at fit wins; ties keep the earlier one", () => {
  const wide: BoardLayout = { n: [["a", 0, 0, 160, 60, 0], ["b", 1600, 0, 160, 60, 0]], e: [] };
  const tall: BoardLayout = { n: [["a", 0, 0, 160, 60, 0], ["b", 0, 400, 160, 60, 0]], e: [] };
  assert.equal(pickLayout([wide, tall]), tall);
  assert.equal(pickLayout([tall, wide]), tall);
  const same: BoardLayout = { n: [["a", 0, 0, 160, 60, 0]], e: [] };
  const copy: BoardLayout = { n: [["a", 5, 5, 160, 60, 0]], e: [] };
  assert.equal(pickLayout([same, copy]), same);
});

test("layout: name size at the default fit shrinks with the drawing", () => {
  const small: BoardLayout = { n: [["a", 0, 0, 160, 60, 0]], e: [] };
  const wide: BoardLayout = { n: [["a", 0, 0, 160, 60, 0], ["b", 3000, 0, 160, 60, 0]], e: [] };
  assert.equal(namePx(small), 14.5);
  assert.ok(namePx(wide) < 5);
});

test("export: arrows carry their weight class and parts their line counts", () => {
  const id = Object.keys(model.boards).find((b) => model.boards[b].edges.some((e) => e.major && (e.imports || e.calls)))!;
  const b = model.boards[id];
  const n: BoardLayout["n"] = b.nodes.map((x, i) => [x, i * 200, 0, 160, 60, model.services[x] ? 1 : 0]);
  const e: BoardLayout["e"] = b.edges.filter((x) => x.major).map((x) => [x.a, x.b, 0, 0, 0, 100, 100]);
  const svg = boardSvg(model, id, { n, e }, "light");
  assert.match(svg, /<g class="wire( call)? w[1-4]"/);
  const part = b.nodes.find((x) => model.nodes[x] && !b.context.includes(x))!;
  assert.ok(svg.includes(partSub(model.nodes[part].count, model.nodes[part].loc)));
});
