// Layout engine spike (#75): elkjs and our own column layout behind an option, D2 still the default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { lintBoard } from "../src/build/lint.ts";
import { drawnBoxes, signedDist } from "../src/build/outline.ts";
import { boardGraph, engineBoard, snapEnds } from "../src/build/engines/graph.ts";
import { columnLayout, jogOrder, ranks } from "../src/build/engines/columns.ts";
import { engineLayout, layoutWith } from "../src/build/engines/index.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const build = (name: string): Model => {
  const facts = analyze(fixtures + name);
  const g = Grouping.parse(defaultGrouping(facts));
  return buildModel(facts, g, assign(g, facts).leafOf);
};

test("columns: ranks by longest path, a source next to its target, a cycle broken once", () => {
  // 0 → 1 → 2, 0 → 2, 3 → 2 (source pulled next to 2), 2 → 1 closes a cycle
  const { rank, back } = ranks(4, [[0, 1], [1, 2], [0, 2], [3, 2], [2, 1]]);
  assert.deepEqual(rank, [0, 1, 2, 1]);
  assert.deepEqual(back, [false, false, false, false, true]);
});

test("columns: jogs in a channel are ordered so wires don't cross", () => {
  // both go down; the one entering lower and leaving higher has to sit right of the other's span
  const t = jogOrder([{ y0: 0, y1: 100 }, { y0: 50, y1: 80 }]);
  assert.equal(new Set(t).size, 2);
  const cost = (L: { y0: number; y1: number }, R: { y0: number; y1: number }) => +(R.y0 > Math.min(L.y0, L.y1) && R.y0 < Math.max(L.y0, L.y1)) + +(L.y1 > Math.min(R.y0, R.y1) && L.y1 < Math.max(R.y0, R.y1));
  const js = [{ y0: 0, y1: 100 }, { y0: 50, y1: 80 }];
  const [l, r] = t[0] < t[1] ? [js[0], js[1]] : [js[1], js[0]];
  assert.equal(cost(l, r), Math.min(cost(js[0], js[1]), cost(js[1], js[0])));
});

test("columns: every box in a column shares its center line, rows share one grid", () => {
  const model = build("multi");
  for (const dir of ["right", "down"] as const) {
    const l = columnLayout(boardGraph(model, "root"), { dir, hgap: 72, vgap: 36 });
    const along = l.n.map(([, x, y, w, h]) => (dir === "right" ? x + w / 2 : y + h / 2));
    const cols = new Set(along.map((v) => Math.round(v)));
    assert.ok(cols.size < l.n.length, `${dir}: some boxes share a column`);
    assert.equal(lintBoard(model, "root", l).metrics.aligned, lintBoard(model, "root", l).metrics.layered);
  }
});

test("snapEnds: an arrowhead stopping at a cylinder's bounding box moves down onto its lid", () => {
  const model = build("multi");
  const svc = boardGraph(model, "root").nodes.find((n) => n.cyl)!;
  const raw: BoardLayout = { n: [["web", 0, 0, 160, 60, 0], [svc.id, 300, 200, svc.w, svc.h, 1]], e: [["web", svc.id, 0, 80, 60, 80, 120, 310, 120, 310, 200]] };
  const out = snapEnds(model, "root", raw), p = out.e[0].slice(3) as number[];
  const parts = drawnBoxes(model, "root", out.n).find((d) => d.id === svc.id)!.parts;
  assert.ok(Math.abs(signedDist([p[p.length - 2], p[p.length - 1]], parts)) <= 2);
  assert.ok(p[p.length - 1] > 200, "the end moved down the lid's curve");
});

for (const f of readdirSync(fixtures).sort()) {
  test(`engines: fixture ${f} lays out with elkjs and columns, without hard defects, deterministically`, async () => {
    const model = build(f);
    const ids = Object.keys(model.boards).filter((id) => engineBoard(model, id)).sort();
    for (const engine of ["elkjs", "columns"] as const) for (const id of ids) {
      const l = await engineLayout(model, id, engine);
      assert.deepEqual(lintBoard(model, id, l).defects.map((d) => `${engine} ${id} ${d.kind}: ${d.detail}`), []);
      assert.deepEqual(await engineLayout(model, id, engine), l);
      assert.deepEqual(l.n.map((n) => n[0]).sort(), [...model.boards[id].nodes].sort());
    }
  });
}

test("engines: d2 stays the default, and the other engines leave store boards to it", async () => {
  const model = build("stores");
  const d2 = await layoutBoards(model);
  assert.deepEqual(await layoutWith(model, "d2"), d2);
  const cols = await layoutWith(model, "columns");
  for (const id of Object.keys(d2)) if (!engineBoard(model, id)) assert.deepEqual(cols[id], d2[id]);
  assert.ok(Object.keys(d2).some((id) => !engineBoard(model, id)), "the fixture has a store board");
});
