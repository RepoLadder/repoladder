import { test } from "node:test";
import assert from "node:assert/strict";
import { connectOrphans } from "../src/model/orphans.ts";
import { markContext, markMajor, reduceShortcuts, type ModelEdge } from "../src/model/rollup.ts";

const edge = (a: string, b: string, imports: number, calls = 0, uses = 0): ModelEdge => ({ a, b, imports, calls, uses, major: false, ev: [] });
const drawn = (es: ModelEdge[]) => es.filter((e) => e.major).map((e) => `${e.a}>${e.b}`).sort();

// ten boxes that all import each other, with a deterministic spread of weights
const kids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const mesh = () => kids.flatMap((x, i) => kids.filter((y) => y !== x).map((y, j) => edge(x, y, ((i * 7 + j * 3) % 9) + 1)));

test("dense board: a tight mesh draws about 1.2 arrows per box", () => {
  const es = mesh();
  markMajor(es, kids);
  assert.ok(es.filter((e) => e.major).length <= 12, `${es.filter((e) => e.major).length} drawn`);
  assert.ok(es.filter((e) => e.major).length >= 6);
});

test("dense board: a box whose strongest edge is weak gets no guaranteed arrow", () => {
  const es = [...mesh().filter((e) => e.a !== "j"), ...kids.slice(0, 9).map((k) => edge("j", k, 1))];
  markMajor(es, kids);
  assert.ok(es.filter((e) => e.a === "j").every((e) => !e.major));
});

test("sparse board: every box keeps its strongest edge, however weak", () => {
  const ks = ["a", "b", "c", "d", "e"];
  const es = [edge("a", "b", 9), edge("b", "c", 8), edge("c", "d", 1), edge("d", "e", 1), edge("e", "a", 1)];
  markMajor(es, ks);
  assert.ok(es.every((e) => e.major));
});

test("dense board: runtime calls and service edges are never hidden", () => {
  const es = [...mesh(), edge("a", "j", 1, 1), edge("b", "c", 0, 0, 3), edge("d", "e", 0, 1)];
  markMajor(es, kids);
  assert.ok(es.filter((e) => e.calls || e.uses).every((e) => e.major));
});

test("shortcuts: a weak A->C is hidden when A->B->C is drawn", () => {
  const es = [edge("a", "b", 10), edge("b", "c", 8), edge("a", "c", 2)];
  for (const e of es) e.major = true;
  reduceShortcuts(es);
  assert.deepEqual(drawn(es), ["a>b", "b>c"]);
});

test("shortcuts: a heavy A->C, a runtime call, or a missing leg keeps the arrow", () => {
  const heavy = [edge("a", "b", 10), edge("b", "c", 8), edge("a", "c", 5)];
  const call = [edge("a", "b", 10), edge("b", "c", 8), edge("a", "c", 0, 1)];
  const gap = [edge("a", "b", 10), edge("b", "c", 8), edge("a", "c", 1)];
  for (const es of [heavy, call, gap]) for (const e of es) e.major = true;
  gap[1].major = false;
  for (const es of [heavy, call, gap]) reduceShortcuts(es);
  assert.ok(heavy[2].major && call[2].major && gap[2].major);
});

test("shortcuts: a leg that stands in for a hidden shortcut stays drawn", () => {
  // a->c rides a->b->c; b->c would itself be a shortcut of b->d->c, but it is a leg now
  const es = [edge("a", "b", 20), edge("b", "c", 8), edge("a", "c", 2), edge("b", "d", 40), edge("d", "c", 40)];
  for (const e of es) e.major = true;
  reduceShortcuts(es);
  assert.deepEqual(drawn(es), ["a>b", "b>c", "b>d", "d>c"]);
});

test("context: only the heaviest imports to boxes elsewhere are drawn, calls always", () => {
  const inside = [edge("a", "b", 10), edge("b", "c", 10), edge("c", "a", 10), edge("a", "c", 10)];
  for (const e of inside) e.major = true;
  const ctx = ["x", "y", "z"].flatMap((o, i) => ["a", "b", "c"].map((k, j) => edge(k, o, 20 + i * 3 + j)));
  ctx.push(edge("a", "w", 0, 1));
  markContext(ctx, inside, 3);
  // budget max(6 - 4, round(3 * 0.5)) = 2 imports, plus the call
  assert.deepEqual(drawn(ctx), ["a>w", "b>z", "c>z"]);
});

test("context: light imports stay hidden even with budget to spare", () => {
  const inside = [edge("a", "b", 40)];
  inside[0].major = true;
  const ctx = [edge("a", "x", 2), edge("b", "x", 7), edge("b", "y", 9)];
  markContext(ctx, inside, 2);
  assert.deepEqual(drawn(ctx), ["b>y"]);
});

// #126: a box whose every edge lost the cut floats, and reads as unused
test("orphans: a box with no drawn edge gets its strongest one back, preferring boxes already shown", () => {
  const es = [edge("a", "b", 9, 0, 0), edge("c", "a", 2), edge("c", "b", 5), edge("c", "x", 20)];
  es[0].major = true;
  const promoted = connectOrphans(es, ["a", "b", "c"], ["a", "b", "c"], (id) => id === "x");
  assert.deepEqual(promoted.map((e) => `${e.a}>${e.b}`), ["c>b"]);
  assert.deepEqual(drawn(es), ["a>b", "c>b"]);
});

test("orphans: a runtime call beats heavier imports; an elsewhere box is drawn only when nothing on the board connects", () => {
  const es = [edge("a", "b", 9), edge("a", "c", 0, 1), edge("d", "x", 4), edge("d", "svc-y", 0, 0, 3)];
  connectOrphans(es, ["a", "b", "c", "d"], ["a", "b", "c", "d"], (id) => id === "x");
  assert.deepEqual(drawn(es), ["a>b", "a>c", "d>x"]);
});

test("orphans: never invents an edge; a box with none stays as it is", () => {
  const es = [edge("a", "b", 1)];
  assert.deepEqual(connectOrphans(es, ["a", "b", "c"], ["a", "b", "c"]).length, 1);
  assert.equal(es.length, 1);
});
