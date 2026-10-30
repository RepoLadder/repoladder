// Alphabetical ranges read in order on their board (#241): build/rangeorder.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitOverBudget } from "../src/model/budgetsplit.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Facts, Grouping } from "../src/model/schema.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { crossings, isRange, orderRanges, shift } from "../src/build/rangeorder.ts";
import { lintBoard } from "../src/build/lint.ts";

const facts = (files: string[], imports: [string, string][] = []): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" as const })),
  externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});

test("shift slides a wire's last bend along its track, or jogs just outside the box", () => {
  // right, down a track at x=50, right into the box at (100, 40): the box moves down 30
  assert.deepEqual(shift(["a", "b", 0, 0, 0, 50, 0, 50, 40, 100, 40], true, 1, 30), ["a", "b", 0, 0, 0, 50, 0, 50, 70, 100, 70]);
  // the same, moving the wire's start instead
  assert.deepEqual(shift(["a", "b", 0, 100, 40, 50, 40, 50, 0, 0, 0], false, 1, 30), ["a", "b", 0, 100, 70, 50, 70, 50, 0, 0, 0]);
  // a straight wire takes a jog 12px before the box
  assert.deepEqual(shift(["a", "b", 0, 0, 40, 100, 40], true, 1, -20), ["a", "b", 0, 0, 40, 88, 40, 88, 20, 100, 20]);
  // a wire that meets the box on a side along the move can't follow it
  assert.equal(shift(["a", "b", 0, 0, 0, 0, 40], true, 1, 10), null);
  // a track another wire already runs along steps toward the box
  const other: [string, string, 0, ...number[]] = ["c", "d", 0, 0, 60, 50, 60, 50, 90, 100, 90];
  assert.deepEqual(shift(["a", "b", 0, 0, 0, 50, 0, 50, 40, 100, 40], true, 1, 30, [other]), ["a", "b", 0, 0, 0, 58, 0, 58, 70, 100, 70]);
});

test("crossings counts wires crossing away from their ends", () => {
  assert.equal(crossings({ n: [], e: [["a", "b", 0, 0, 50, 100, 50], ["c", "d", 0, 50, 0, 50, 100]] }), 1);
  assert.equal(crossings({ n: [], e: [["a", "b", 0, 0, 50, 100, 50], ["a", "d", 0, 0, 50, 50, 100]] }), 0);
});

test("a flat folder's ranges are laid out in alphabetical order (#241)", async () => {
  // zod's locales: 60 files with no seam, all importing one core file, and an outside file importing
  // a range in the middle, which ELK would pull up toward it
  const codes = Array.from({ length: 60 }, (_, i) => `${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 6)]}${"bdfhjz"[i % 6]}`);
  const files = codes.map((c) => `src/feat/${c}.ts`);
  const outside = ["src/core/core.ts", "src/res/res.ts", "src/other/o.ts"];
  const f = facts([...files, ...outside], [...files.map((x): [string, string] => [x, "src/core/core.ts"]), ["src/res/res.ts", "src/feat/fb.ts"], ["src/res/res.ts", "src/feat/hj.ts"]]);
  const g: Grouping = splitOverBudget({ version: 1, summary: "t", children: [
    { id: "feat", name: "Feat", summary: "", files: ["src/feat/**"] },
    { id: "core", name: "Core", summary: "", files: ["src/core/**"] },
    { id: "res", name: "Res", summary: "", files: ["src/res/**"] },
    { id: "other", name: "Other", summary: "", files: ["src/other/**"] },
  ] }, f);
  const model = buildModel(f, g, assign(g, f).leafOf);
  const kids = model.nodes.feat.children;
  assert.ok(kids.length >= 3 && kids.every((id) => isRange(model, id)), kids.join());
  const l = (await layoutBoards(model, { only: ["feat"] })).feat;
  const at = new Map(l.n.map((r) => [r[0], r]));
  const boxes = kids.map((id) => at.get(id)!);
  const column = new Set(boxes.map((r) => r[1])).size === 1, row = new Set(boxes.map((r) => r[2])).size === 1;
  assert.ok(column || row, "the ranges share a layer");
  const pos = boxes.map((r) => (column ? r[2] : r[1]));
  assert.deepEqual(pos, [...pos].sort((p, q) => p - q), `in order: ${kids.map((id, i) => `${model.nodes[id].name}@${pos[i]}`).join(", ")}`);
  assert.deepEqual(lintBoard(model, "feat", l).defects, []);

  // ELK's crossing minimization may hand the ranges over out of order, as on zod's locales: two
  // ranges trade places, each with the other's wires. orderRanges puts them back, wires and all.
  const [p, q] = [kids[1], kids[2]], swap = (id: string) => (id === p ? q : id === q ? p : id);
  const mis = { n: l.n.map((r) => [swap(r[0]), ...r.slice(1)] as typeof r), e: l.e.map((w) => [swap(w[0]), swap(w[1]), ...w.slice(2)] as typeof w) };
  assert.notDeepEqual(mis, l);
  const back = orderRanges(model, "feat", mis);
  const sorted = (x: typeof l) => ({ n: [...x.n].sort((a, b) => a[0].localeCompare(b[0])), e: [...x.e].sort((a, b) => `${a[0]}>${a[1]}`.localeCompare(`${b[0]}>${b[1]}`)) });
  assert.deepEqual(sorted(back), sorted(l));
});
