// A board cut at a box budget, laid out with containers (viewer/cutboard.ts + everylayout.ts via
// stoplayout.ts cutLayout, #171): opened groups are containers, closed groups keep their Default
// size, every arrow is between two boxes of one container, and Everything is the root's cut at
// Infinity. elkjs runs in Node in place of the page's Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { everyDefects } from "../src/build/everylint.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import type { ViewerData } from "../src/viewer/state.ts";
import { cut, type Cut } from "../src/viewer/budget.ts";
import { cutBoard } from "../src/viewer/cutboard.ts";
import { everyGraphs, nameSize, topOf } from "../src/viewer/everylayout.ts";
import { cutLayout } from "../src/viewer/stoplayout.ts";
import { laneSide, type LaneSide } from "../src/viewer/everyfit.ts";

const elk = new (bundled as unknown as new () => ElkApi)();
const run = (g: ElkNode) => elk.layout(g);
const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));

let cached: ViewerData | null = null;
async function deep(): Promise<ViewerData> {
  if (cached) return cached;
  const g = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
  const facts = analyze(dir);
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  return (cached = pageData(renderHtml(model, await layoutBoards(model))));
}

/** A cut by hand: `board` with the groups in `opened` opened (each to its children, or a leaf to its files). */
function opening(d: ViewerData, board: string, opened: string[]): Cut {
  const kids = (id: string) => (d.nodes[id].children.length ? d.nodes[id].children : d.nodes[id].files.map((f) => `@${typeof f === "number" ? f : d.paths.indexOf(f)}`));
  const open: Record<string, string[]> = { [board]: kids(board) };
  for (const id of opened) open[id] = kids(id);
  const boxes: string[] = [];
  const walk = (id: string) => { for (const c of open[id]) (open[c] ? walk(c) : boxes.push(c)); };
  walk(board);
  return { board, budget: 30, open, boxes };
}

test("a cut's board: containers for opened groups, closed boxes inside them, arrows only between siblings", async () => {
  const d = await deep();
  const c = opening(d, "app", ["billing", "invoices"]);
  const b = cutBoard(d, c);
  assert.deepEqual(b.cut, { board: "app", budget: 30 });
  for (const id of c.boxes) assert.ok(b.nodes.includes(id), `${id} drawn`);
  for (const id of ["billing", "invoices"]) assert.ok(b.nodes.includes(id), `${id} is a container`);
  assert.equal(b.inside!.billing, "app");
  assert.equal(b.inside!.invoices, "billing");
  assert.equal(b.inside!.pdf, "invoices", "a closed group sits in its opened parent");
  assert.ok(!b.nodes.includes("pdf-layout"), "a closed group's parts are not drawn");
  for (const e of b.edges) assert.equal(b.inside![e.a], b.inside![e.b], `${e.a}>${e.b} joins two boxes of one container`);
  // the board's "elsewhere" boxes and services sit at its top level, as on Default
  for (const id of b.context) assert.equal(b.inside![id], "app");
  assert.deepEqual(b.context, d.boards.app.context);
});

test("a cut is laid out: every box inside its container, siblings apart, every arrow drawn, no hard defects", async () => {
  const d = await deep();
  for (const [board, opened] of [["app", ["billing", "invoices"]], ["app", ["shell", "billing"]], ["billing", ["invoices", "pdf"]], ["root", ["app"]]] as const) {
    const c = opening(d, board, [...opened]);
    const { board: b, laid } = cutLayout(d, c, run);
    const l = await laid;
    const at = new Map(l.n.map((n) => [n[0], n]));
    assert.deepEqual([...at.keys()].sort(), [...b.nodes].sort(), `${board}: every box placed`);
    assert.equal(l.e.length, b.edges.length, `${board}: every arrow drawn`);
    assert.deepEqual(everyDefects(b, l), [], `${board} with ${opened}: no hard lint defects`);
    // a closed group keeps the size Default gives it on its parent's board
    for (const id of c.boxes) {
      if (id[0] === "@") continue;
      const def = d.layout[b.inside![id]]?.n.find((n) => n[0] === id);
      if (def) assert.deepEqual(at.get(id)!.slice(3, 5), def.slice(3, 5), `${id} keeps its Default size`);
    }
  }
});

test("a container holding closed groups lays them out layered; one holding containers packs them", async () => {
  const d = await deep();
  const b = cutBoard(d, opening(d, "app", ["billing"]));
  const [g] = everyGraphs(d, d.nodes, b);
  assert.equal(g.layoutOptions?.["elk.algorithm"], "rectpacking", "the board holds a container: packed");
  const billing = g.children!.find((n) => n.id === "billing")!;
  assert.equal(billing.layoutOptions?.["elk.algorithm"], "layered", "billing holds only closed boxes: layered");
  assert.ok(nameSize(b, 1, d.nodes) >= 22, "a container's name reads at the fit");
});

test("a cut that opens nothing is the Default board with its D2 layout; layouts are kept per (board, budget)", async () => {
  const d = await deep();
  const none = cut(d.nodes, d.paths, "app", 0);
  assert.deepEqual(Object.keys(none.open), ["app"]);
  const got = cutLayout(d, none, run);
  assert.equal(got.board, d.boards.app);
  assert.equal(await got.laid, d.layout.app);
  const c = opening(d, "app", ["billing"]);
  assert.equal(cutLayout(d, c, run), cutLayout(d, c, run), "asked again, the same layout");
});

test("Everything is the root's cut at Infinity", async () => {
  const d = await deep();
  const all = cut(d.nodes, d.paths, "root", Infinity);
  const every = cutLayout(d, all, run).board;
  assert.deepEqual(every, cutBoard(d, all));
  // the cut walks the fine tree, whose buckets can reorder a group's children: the board keeps Default's order
  const shuffled = Object.fromEntries(Object.entries(d.nodes).map(([id, n]) => [id, { ...n, children: [...n.children].reverse() }]));
  assert.deepEqual(cutBoard(d, cut(shuffled, d.paths, "root", Infinity)), every);
});

test("the lane and services sit on the board's edge: right on a wide canvas, bottom on a tall one, never in the packing (#183)", async () => {
  const d = await deep();
  // a board with elsewhere boxes, cut so its top holds a container
  const id = Object.keys(d.boards).find((k) => d.nodes[k]?.children.some((c) => d.nodes[c].children.length || d.nodes[c].files.length) && (d.boards[k].context?.length ?? 0) > 0)!;
  assert.ok(id, "the fixture has a board with an elsewhere lane");
  const cuts = [opening(d, id, [d.nodes[id].children[0]]), cut(d.nodes, d.paths, id, Infinity), cut(d.nodes, d.paths, "root", Infinity)];
  let laned = 0;
  for (const c of cuts) {
    const b = cutBoard(d, c), top = topOf(b);
    const lane = b.nodes.filter((n) => (b.inside?.[n] ?? top) === top && (b.context.includes(n) || d.services[n]));
    if (!lane.length) continue;
    laned++;
    const [g] = everyGraphs(d, d.nodes, b);
    assert.ok(!g.children!.some((n) => lane.includes(n.id)), "the lane is not packed");
    for (const [aspect, side] of [[1.6], [0.5], [0.5, "right"]] as [number, LaneSide?][]) {
      const l = await cutLayout(d, c, run, { aspect, side }).laid, at = new Map(l.n.map((n) => [n[0], n]));
      const parts = l.n.filter((n) => !lane.includes(n[0]));
      const right = Math.max(...parts.map((n) => n[1] + n[3])), bottom = Math.max(...parts.map((n) => n[2] + n[4]));
      for (const x of lane) {
        const [, lx, ly] = at.get(x)!;
        if ((side ?? laneSide(aspect)) === "right") assert.ok(lx > right, `${c.board}: ${x} right of the parts`);
        else assert.ok(ly > bottom, `${c.board}: ${x} below the parts on a tall canvas`);
      }
      assert.deepEqual(everyDefects(b, l), [], `${c.board} at ${aspect}: no hard defects`);
    }
  }
  assert.ok(laned >= 2, "the lane was checked on a cut and on Everything");
  const c = cuts[0];
  assert.notEqual(cutLayout(d, c, run, { lane: "packed" }), cutLayout(d, c, run), "the packed lane (an experimental variant) is kept apart");
  assert.notEqual(cutLayout(d, c, run, { aspect: 0.5 }), cutLayout(d, c, run), "each canvas shape has its own layout");
  assert.notEqual(cutLayout(d, c, run, { aspect: 0.5, side: "right" }), cutLayout(d, c, run, { aspect: 0.5 }), "and each side of the lane");
});
