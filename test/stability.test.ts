// Pair stability (src/build/stability.ts, scripts/stability.ts, #462).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pairStability, STABLE_EPS, STABLE_SAMPLE } from "../src/build/stability.ts";
import type { BoardLayout } from "../src/build/layout.ts";
import { aspectLayouts, byPath, commitRows, elkRun, loadSource, storyRows, windowRows } from "../scripts/stability.ts";
import { STORY, type ViewerData } from "../src/viewer/state.ts";

type N = BoardLayout["n"];
const box = (id: string, x: number, y: number): N[number] => [id, x, y, 10, 10, 0];

test("identical layouts score 1; a mirrored row scores 0", () => {
  const row: N = [box("a", 0, 0), box("b", 20, 0), box("c", 40, 0), box("d", 60, 0)];
  const same = pairStability(row, row);
  assert.equal(same.score, 1);
  assert.equal(same.kept, same.total);
  const mirrored: N = row.map(([k, x, y, w, h, s]) => [k, 60 - x, y, w, h, s]);
  assert.equal(pairStability(row, mirrored).score, 0);
});

test("a pair is kept only when both axes match", () => {
  // 2x2 grid a b / c d, transposed: b and c swap. pairs: ab(h) ac(v) ad(diag) bc(diag) bd(v) cd(h)
  const g: N = [box("a", 0, 0), box("b", 20, 0), box("c", 0, 20), box("d", 20, 20)];
  const t: N = [box("a", 0, 0), box("b", 0, 20), box("c", 20, 0), box("d", 20, 20)];
  const s = pairStability(g, t);
  // ab: right/same -> same/below (lost); ac lost; ad: right+below both times (kept); bc: left+below -> right+above (lost); bd lost; cd lost
  assert.deepEqual([s.kept, s.total], [1, 6]);
});

test("a fixed synthetic pair has a hand-computed score", () => {
  // a(0,0) b(20,0) c(40,0) -> c moves left of a: pairs ab kept, ac lost, bc lost => 1/3
  const x: N = [box("a", 0, 0), box("b", 20, 0), box("c", 40, 0)];
  const y: N = [box("a", 20, 0), box("b", 40, 0), box("c", 0, 0)];
  const s = pairStability(x, y);
  assert.equal(s.kept, 1);
  assert.equal(s.total, 3);
  assert.equal(s.score, 1 / 3);
});

test("centers within STABLE_EPS are the same band and match only the same band", () => {
  const a: N = [box("a", 0, 0), box("b", STABLE_EPS, 0)];
  assert.equal(pairStability(a, [box("a", 0, 0), box("b", -STABLE_EPS, 0)]).score, 1);
  assert.equal(pairStability(a, [box("a", 0, 0), box("b", STABLE_EPS + 1, 0)]).score, 0);
  assert.equal(pairStability([box("a", 0, 0), box("b", 30, 0)], a).score, 0);
});

test("only shared ids count; ids restricts; fewer than 2 gives null", () => {
  const a: N = [box("a", 0, 0), box("b", 20, 0), box("x", 40, 0)];
  const b: N = [box("a", 0, 0), box("b", 20, 0), box("y", 5, 5)];
  const s = pairStability(a, b);
  assert.deepEqual([s.shared, s.total, s.score], [2, 1, 1]);
  const r = pairStability(a, b, ["a"]);
  assert.equal(r.score, null);
  assert.equal(r.shared, 1);
  assert.equal(pairStability(a, [box("q", 0, 0)]).score, null);
});

test("above STABLE_SAMPLE shared boxes the score is a deterministic sample", () => {
  const n = STABLE_SAMPLE + 100;
  const a: N = Array.from({ length: n }, (_, i) => box(`b${i}`, (i % 30) * 20, Math.floor(i / 30) * 20));
  const b: N = a.map(([k, x, y, w, h, s], i) => [k, x + (i % 7 === 0 ? 50 : 0), y, w, h, s]);
  const one = pairStability(a, b), two = pairStability(a, b), rev = pairStability([...a].reverse(), [...b].reverse());
  assert.equal(one.sampled, true);
  assert.equal(one.shared, n);
  assert.deepEqual(two, one);
  assert.deepEqual(rev, one);
  assert.equal(pairStability(a.slice(0, STABLE_SAMPLE), a.slice(0, STABLE_SAMPLE)).sampled, false);
});

const run = elkRun();

test("window shapes on a fixture: scores in [0, 1] and the lane-flip pair", async () => {
  const { data } = await loadSource("fixture:deep");
  const [p, w] = await aspectLayouts(data, "root", [0.46, 1.6], run);
  const s = pairStability(p, w);
  assert.ok(s.score !== null && s.score >= 0 && s.score <= 1);
  const rows = await windowRows(data, "root", run);
  assert.equal(rows.length, 4);
  assert.match(rows[3].label, /lane flip/);
  for (const r of rows) assert.ok(r.s.score === null || (r.s.score >= 0 && r.s.score <= 1));
});

test("two commits: a temp copy of deep with an added file", async () => {
  const before = await loadSource("fixture:deep");
  const tmp = mkdtempSync(join(tmpdir(), "stability-"));
  cpSync(fileURLToPath(new URL("./fixtures/deep", import.meta.url)), tmp, { recursive: true });
  const src = join(tmp, "src");
  const dir = readdirSync(src, { withFileTypes: true }).find((d) => d.isDirectory());
  const into = dir ? join(src, dir.name) : src;
  mkdirSync(into, { recursive: true });
  writeFileSync(join(into, "added.ts"), "export const added = 1;\n");
  // the copy lives outside test/fixtures, so build it through a model directly
  const { analyze } = await import("../src/analyze/index.ts");
  const { assign } = await import("../src/model/grouping.ts");
  const { buildModel } = await import("../src/model/rollup.ts");
  const { Grouping } = await import("../src/model/schema.ts");
  const { layoutBoards } = await import("../src/build/layout.ts");
  const { pageData } = await import("../src/build/filepack.ts");
  const { renderHtml } = await import("../src/build/html.ts");
  const { readFileSync } = await import("node:fs");
  const g = Grouping.parse(JSON.parse(readFileSync(join(tmp, "grouping.json"), "utf8")));
  const facts = analyze(tmp);
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  const after = { name: "after", model, data: pageData(renderHtml(model, await layoutBoards(model))) };
  const c = commitRows(before, after);
  assert.ok(c.boards > 0);
  assert.ok(c.mean! >= 0 && c.mean! <= 1 && c.min! <= c.mean!);
  assert.ok(c.worst.length <= 3);
  // file boxes are numbered in first-seen order: a shifted index must not read as movement
  assert.notDeepEqual(before.data.paths, after.data.paths);
  const keyed = Object.keys(before.data.layout).filter((id) => after.data.layout[id] && JSON.stringify(byPath(before.data, before.data.layout[id])) === JSON.stringify(byPath(after.data, after.data.layout[id])));
  assert.ok(keyed.length > 0);
  for (const id of keyed) assert.equal(pairStability(byPath(before.data, before.data.layout[id]), byPath(after.data, after.data.layout[id])).score, 1, id);
  assert.ok(keyed.some((id) => JSON.stringify(before.data.layout[id].n) !== JSON.stringify(after.data.layout[id].n)), "a board whose raw ids shifted");
  const same = commitRows(before, before);
  assert.equal(same.mean, 1);
});

test("story vs root: null without an Overview, the shared-box score with one", async () => {
  const { data } = await loadSource("fixture:deep");
  assert.equal(storyRows(data), null);
  const fake = { layout: { [STORY]: [box("a", 0, 0), box("b", 20, 0)], root: [box("a", 0, 0), box("b", 20, 0), box("c", 40, 0)] } } as unknown as ViewerData;
  (fake.layout as Record<string, unknown>)[STORY] = { n: fake.layout[STORY], e: [] };
  (fake.layout as Record<string, unknown>).root = { n: fake.layout.root, e: [] };
  const s = storyRows(fake)!;
  assert.deepEqual([s.shared, s.score], [2, 1]);
});
