// Fitting a board of containers to the window (viewer/everyfit.ts + skyline.ts, #183): the skyline
// packing keeps boxes apart and inside the strip, the canvas shape is bucketed, the lane sits beside
// the parts, and a repacked board covers within ORDER_SLACK of ELK's one pass or more (#463).
import { test } from "node:test";
import assert from "node:assert/strict";
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import { packings, skyline } from "../src/viewer/skyline.ts";
import { aspectBucket, fitScore, LANE_TALL, laneRects, laneSide, ORDER_SLACK, repack } from "../src/viewer/everyfit.ts";

const elk = new (bundled as unknown as new () => ElkApi)();
const apart = (a: number[], b: number[], g: number) => a[0] + a[2] + g <= b[0] + 1e-6 || b[0] + b[2] + g <= a[0] + 1e-6 || a[1] + a[3] + g <= b[1] + 1e-6 || b[1] + b[3] + g <= a[1] + 1e-6;
const sizes: [number, number][] = [[400, 300], [200, 120], [180, 260], [300, 90], [120, 120], [500, 140], [90, 200]];

test("skyline: every box inside the strip, at least the gap from every other", () => {
  for (const width of [500, 700, 1000, 2000]) {
    const p = skyline(sizes, width, 36);
    const r = p.at.map(([x, y], i) => [x, y, ...sizes[i]]);
    for (const [x, y, w] of r) assert.ok(x >= 0 && y >= 0 && x + w <= width + 1e-6, `inside ${width}`);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(apart(r[i], r[j], 36), `${i} and ${j} apart at ${width}`);
    assert.equal(p.w, Math.max(...r.map(([x, , w]) => x + w)));
  }
  // a short box tucks in beside a tall one rather than starting a new row under it
  const t = skyline([[100, 300], [100, 100], [100, 100]], 240, 20);
  assert.deepEqual(t.at, [[0, 0], [120, 0], [120, 120]]);
});

test("packings: several orders and widths, each with the order it used", () => {
  const ps = packings(sizes, 1.6, 36);
  assert.ok(ps.length >= 6);
  for (const p of ps) assert.deepEqual([...p.order].sort((a, b) => a - b), sizes.map((_, i) => i));
  const shapes = new Set(ps.map((p) => Math.round((p.w / p.h) * 10)));
  assert.ok(shapes.size >= 3, "packings of several shapes");
});

test("packings: those marked ordered read row by row in the given order, with the first box at the corner (#463)", () => {
  const rowMajor = (s: [number, number][], p: { at: [number, number][] }) => s.map((_, i) => i).sort((a, b) => (Math.abs(p.at[a][1] - p.at[b][1]) > 1e-6 ? p.at[a][1] - p.at[b][1] : p.at[a][0] - p.at[b][0]));
  const widths = new Set<number>(), aspects = new Set<number>();
  for (const t of [0.5, 1.6, 2.2]) {
    const ps = packings(sizes, t, 36), ord = ps.filter((p) => p.ordered);
    assert.ok(ord.length >= 6 && ord.length < ps.length, "some ordered, some not");
    for (const p of ord) {
      assert.deepEqual(p.order, sizes.map((_, i) => i));
      assert.deepEqual(rowMajor(sizes, p), sizes.map((_, i) => i));
      assert.deepEqual(p.at[0], [0, 0]);
      widths.add(Math.round(p.w));
      aspects.add(Math.round(p.w / p.h * 10));
    }
    for (const p of ps) if (p.order.some((k, i) => k !== i)) assert.equal(p.ordered, false, "tallest-first and largest-first are not ordered");
  }
  assert.ok(widths.size >= 3 && aspects.size >= 3);
  // a later box lands beside the first, above the second: not ordered
  const tuck: [number, number][] = [[300, 100], [300, 300], [200, 200]];
  const skylines = packings(tuck, 1, 20).filter((p) => p.order.every((k, i) => k === i));
  const bad = skylines.find((p) => !p.ordered)!;
  assert.ok(bad, "a tucked packing is not ordered");
  assert.deepEqual(rowMajor(tuck, bad), [0, 2, 1]);
  for (const p of skylines.filter((p) => p.ordered)) assert.deepEqual(rowMajor(tuck, p), [0, 1, 2]);
});

test("aspectBucket: a resize within a bucket keeps the layout; no canvas means the desktop's", () => {
  assert.equal(aspectBucket(1280, 800), aspectBucket(1300, 800));
  assert.notEqual(aspectBucket(1280, 800), aspectBucket(390, 844));
  assert.ok(aspectBucket(390, 844) < 1);
  assert.equal(aspectBucket(0, 0), 1.6);
});

test("laneSide: right on landscape and near-square canvases, the bottom only on a clearly tall one (#246)", () => {
  for (const a of [1.6, 1, 0.82, 0.69]) assert.equal(laneSide(a), "right", `at ${a}`);
  for (const a of [0.63, 0.5, 0.3]) assert.equal(laneSide(a), "bottom", `at ${a}`);
  assert.equal(laneSide(1.6, "bottom"), "right");
  assert.equal(laneSide(0.3, "right"), "bottom");
});

test("laneSide: a placed lane keeps its side until the canvas moves well past the line", () => {
  // just past the line either way: no flip
  assert.equal(laneSide(LANE_TALL - 0.03, "right"), "right");
  assert.equal(laneSide(LANE_TALL + 0.03, "bottom"), "bottom");
  // well past it: flips
  assert.equal(laneSide(LANE_TALL - 0.08, "right"), "bottom");
  assert.equal(laneSide(LANE_TALL + 0.08, "bottom"), "right");
  // a window dragged back and forth across the line stays on the side it started on
  let side = laneSide(0.95);
  for (const a of [0.68, 0.64, 0.62, 0.65, 0.69, 0.66]) side = laneSide(a, side);
  assert.equal(side, "right");
  side = laneSide(0.5);
  for (const a of [0.62, 0.68, 0.7, 0.65]) side = laneSide(a, side);
  assert.equal(side, "bottom");
});

test("laneRects: a column right of the parts, or a row below them, wrapping when longer", () => {
  const parts = { x: 0, y: 0, w: 1000, h: 300 }, boxes: [string, number, number][] = [["a", 120, 74], ["b", 120, 74], ["c", 120, 74], ["d", 120, 74]];
  const right = laneRects(boxes, parts, "right", 36);
  for (const r of right.values()) assert.ok(r.x >= 1000 + 72);
  assert.ok(new Set([...right.values()].map((r) => r.x)).size === 2, "four boxes don't fit one 300px column");
  const below = laneRects(boxes, parts, "bottom", 36);
  for (const r of below.values()) assert.ok(r.y >= 300 + 72);
  assert.equal(new Set([...below.values()].map((r) => r.y)).size, 1, "one row fits under 1000px");
});

test("repack: covers at least ORDER_SLACK short of ELK's one pass (none short with no slack), keeps every leaf container's insides", async () => {
  // a board of three containers of leaf containers, each leaf a few boxes, packed by ELK
  const leaf = (id: string, n: number, w: number): ElkNode => ({ id, layoutOptions: { "elk.algorithm": "layered", "elk.padding": "[top=40,left=14,bottom=14,right=14]" }, children: Array.from({ length: n }, (_, i) => ({ id: `${id}.${i}`, width: w, height: 45 })), edges: [] });
  const mid = (id: string, kids: ElkNode[]): ElkNode => ({ id, layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.5", "elk.spacing.nodeNode": "36", "elk.padding": "[top=60,left=36,bottom=36,right=36]" }, children: kids, edges: [] });
  const g: ElkNode = { id: "root", layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.5", "elk.spacing.nodeNode": "36", "elk.padding": "[top=36,left=36,bottom=36,right=36]" }, children: [
    mid("a", [leaf("a1", 6, 160), leaf("a2", 2, 200), leaf("a3", 9, 140)]),
    mid("b", [leaf("b1", 3, 180), leaf("b2", 12, 120)]),
    mid("c", [leaf("c1", 1, 220), leaf("c2", 4, 150), leaf("c3", 2, 160), leaf("c4", 5, 130)]),
  ], edges: [] };
  const opts = new Map<string, ElkNode["layoutOptions"]>();
  const ix = (n: ElkNode) => { opts.set(n.id, n.layoutOptions); n.children?.forEach(ix); };
  ix(g);
  const r = await elk.layout(structuredClone(g));
  const lane: [string, number, number][] = [["svc", 120, 74]];
  for (const aspect of [1.6, 0.5]) {
    const [best, s] = repack(r, opts, aspect, lane, 36);
    assert.ok(s >= fitScore(r, lane, aspect, 36) * (1 - ORDER_SLACK) - 1e-9, `at ${aspect}`);
    assert.ok(repack(r, opts, aspect, lane, 36, laneSide(aspect), 0)[1] >= fitScore(r, lane, aspect, 36) - 1e-9, `with no slack at ${aspect}`);
    assert.equal(s, fitScore(best, lane, aspect, 36));
    // the lane's side can differ from what the canvas's shape alone picks (a lane kept on the right of a tall canvas)
    const [held, hs] = repack(r, opts, aspect, lane, 36, "right");
    assert.equal(hs, fitScore(held, lane, aspect, 36, "right"));
    const find = (n: ElkNode, id: string): ElkNode | undefined => (n.id === id ? n : n.children?.map((c) => find(c, id)).find(Boolean));
    for (const id of ["a1", "b2", "c4"]) assert.deepEqual(find(best, id)!.children, find(r, id)!.children, `${id}'s layout kept`);
    // siblings never overlap
    const walk = (n: ElkNode) => {
      const k = n.children ?? [];
      for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) assert.ok(apart([k[i].x!, k[i].y!, k[i].width!, k[i].height!], [k[j].x!, k[j].y!, k[j].width!, k[j].height!], 0), `${k[i].id} and ${k[j].id}`);
      k.forEach(walk);
    };
    walk(best);
  }
});

// a board where tallest-first wins on coverage, so the old chooser moves the first box across window shapes
const flip = async () => {
  const leaf = (id: string, n: number, w: number): ElkNode => ({ id, layoutOptions: { "elk.algorithm": "layered", "elk.padding": "[top=40,left=14,bottom=14,right=14]" }, children: Array.from({ length: n }, (_, i) => ({ id: `${id}.${i}`, width: w, height: 45 })), edges: [] });
  const mid = (id: string, kids: ElkNode[]): ElkNode => ({ id, layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.5", "elk.spacing.nodeNode": "36", "elk.padding": "[top=60,left=36,bottom=36,right=36]" }, children: kids, edges: [] });
  const g: ElkNode = { id: "root", layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.5", "elk.spacing.nodeNode": "36", "elk.padding": "[top=36,left=36,bottom=36,right=36]" }, children: [
    mid("a", [leaf("a1", 2, 150), leaf("a2", 1, 220), leaf("a3", 5, 120), leaf("a4", 3, 200)]),
    mid("b", [leaf("b1", 6, 130), leaf("b2", 1, 180), leaf("b3", 4, 140)]),
    mid("c", [leaf("c1", 3, 160), leaf("c2", 8, 110), leaf("c3", 1, 200), leaf("c4", 2, 150)]),
    mid("d", [leaf("d1", 1, 170), leaf("d2", 5, 130), leaf("d3", 2, 190)]),
    mid("e", [leaf("e1", 4, 150), leaf("e2", 2, 210)]),
  ], edges: [] };
  const opts = new Map<string, ElkNode["layoutOptions"]>();
  const ix = (n: ElkNode) => { opts.set(n.id, n.layoutOptions); n.children?.forEach(ix); };
  ix(g);
  return { g, opts, r: await elk.layout(structuredClone(g)), lane: [["svc", 120, 74]] as [string, number, number][] };
};
const topLeft = (n: ElkNode) => [...n.children!].sort((a, b) => a.y! - b.y! || a.x! - b.x!)[0].id;

test("repack keeps the board's order across window shapes, where the old chooser moves the first box (#463)", async () => {
  const { r, opts, lane } = await flip(), aspects = [0.46, 1, 1.6, 2.2];
  const old = aspects.map((a) => topLeft(repack(r, opts, a, lane, 36, laneSide(a), -1)[0]));
  assert.ok(new Set(old).size > 1, `the old chooser moves the first box: ${old}`);
  const now = aspects.map((a) => repack(r, opts, a, lane, 36, laneSide(a))[0]);
  assert.equal(new Set(now.map(topLeft)).size, 1, `${now.map(topLeft)}`);
});

test("repack falls back to the best packing when order costs more than the slack", async () => {
  const { r, opts, lane } = await flip();
  const at = (a: number, slack: number) => repack(r, opts, a, lane, 36, laneSide(a), slack)[1];
  // at 2.2 the best ordered board covers about 19% less than the best in any order
  const any = at(2.2, -1);
  assert.equal(at(2.2, ORDER_SLACK), any, "dearer than the slack: the best packing in any order");
  assert.equal(at(2.2, 0), any);
  const dear = at(2.2, 0.2);
  assert.ok(dear < any - 1e-6 && dear >= any * 0.8 - 1e-9, "a looser slack takes the ordered board");
  // at 1.6 it costs about 8%: within the slack, so the default keeps the order; no slack does not
  const free = at(1.6, -1), kept = at(1.6, ORDER_SLACK);
  assert.ok(kept < free - 1e-6 && kept >= free * (1 - ORDER_SLACK) - 1e-9, "within the slack: the ordered board");
  assert.equal(at(1.6, 0), free);
});
