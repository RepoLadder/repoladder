// Lanes (#74, on by default since #101): "elsewhere" boxes and services in a lane at the board's edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Model, ModelEdge } from "../src/model/rollup.ts";
import { bendsOnly, boxSizes, d2Source, layoutBoards } from "../src/build/layout.ts";
import { LANE_GAP, LANE_IN, LANE_OUT, isLaneLayoutEdge, isSpacer, laneAtEdge, laneOrder, laneSides, spacerSize, wideLanes, withLanes } from "../src/build/lane.ts";
import type { BoardLayout } from "../src/build/layout.ts";
import { lintModel } from "../src/build/lint.ts";
import { d2Pool } from "../src/build/d2pool.ts";

const node = (id: string, parent: string, children: string[] = []) => ({ id, name: id.toUpperCase(), kind: "web", parent, children, count: 3, loc: 120, files: [] });
const edge = (a: string, b: string, kind = "import"): ModelEdge => ({ a, b, major: true, kind, count: 1, ev: [] }) as unknown as ModelEdge;

// "app" holds five parts; "elsewhere, with a long name" is outside it and receives calls from four of
// them; "source" only sends; "both" sends and receives; svc-pay is a service.
const parts = ["p1", "p2", "p3", "p4", "p5"];
const model = {
  nodes: Object.fromEntries([
    ["root", node("root", "", ["app", "elsewhere, with a long name", "source", "both"])],
    ["app", node("app", "root", parts)],
    ...parts.map((p) => [p, node(p, "app")]),
    ...["elsewhere, with a long name", "source", "both"].map((p) => [p, node(p, "root")]),
  ]),
  services: { "svc-pay": "Payments" },
  boards: {
    app: {
      nodes: [...parts, "elsewhere, with a long name", "source", "both", "svc-pay"],
      context: ["both", "elsewhere, with a long name", "source"],
      hubs: [],
      throughout: [],
      edges: [
        edge("p1", "p2"), edge("p2", "p3"), edge("p3", "p4"),
        ...["p1", "p2", "p3", "p4"].map((p) => edge(p, "elsewhere, with a long name", "call")),
        edge("p5", "svc-pay", "sdk"), edge("source", "p1", "call"), edge("both", "p2", "call"), edge("p4", "both", "call"),
      ],
    },
  },
} as unknown as Model;

test("lane: receivers and services go after the parts, senders before, two-way boxes stay put", () => {
  assert.deepEqual([...laneSides(model, "app")].sort(), [["elsewhere, with a long name", LANE_OUT], ["source", LANE_IN], ["svc-pay", LANE_OUT]]);
});

test("lane: not on a board without elsewhere boxes, nor where few arrows run to the lane", () => {
  const noCtx = { ...model, boards: { app: { ...model.boards.app, context: [] } } } as Model;
  assert.equal(laneSides(noCtx, "app").size, 0);
  const quiet = { ...model, boards: { app: { ...model.boards.app, edges: model.boards.app.edges.slice(0, 4) } } } as Model;
  assert.equal(laneSides(quiet, "app").size, 0);
});

test("lane: lane boxes are declared in their containers, in the given order, and anchored in edge mode", () => {
  const src = d2Source(model, "app", "right", 1, new Set(), { mode: "edge", order: ["svc-pay", "elsewhere, with a long name"] });
  const lines = src.split("\n");
  assert.ok(lines.indexOf(lines.find((l) => l.startsWith(`${LANE_OUT}."svc-pay": `))!) < lines.indexOf(lines.find((l) => l.startsWith(`${LANE_OUT}."elsewhere, with a long name": `))!));
  assert.ok(lines.includes(`"p4" -> ${LANE_OUT}."elsewhere, with a long name"`));
  assert.ok(lines.includes(`${LANE_IN}."source" -> "p1"`));
  // p5 has no arrow onward except to the lane, so it holds the out lane after it
  assert.ok(lines.includes(`"p5" -> ${LANE_OUT}`));
  assert.ok(!d2Source(model, "app", "right", 1, new Set(), { mode: "loose" }).includes(`-> ${LANE_OUT}\n`));
  // without the option the source has no lanes
  assert.ok(!d2Source(model, "app").includes("lane-"));
  assert.equal(withLanes(model, "root", "x\n", (id) => id, { mode: "edge" }), "x\n");
});

test("lane: elsewhere boxes get their own size, apart from the parts", () => {
  const off = boxSizes(model, "app"), on = boxSizes(model, "app", { mode: "edge" });
  assert.deepEqual(off.p1, off["elsewhere, with a long name"]);
  assert.ok(on.p1[0] < on["elsewhere, with a long name"][0]);
});

test("lane: spacers keep a lane's boxes apart, declared between them, sized for the spread", () => {
  assert.equal(spacerSize("right", 1), null);
  assert.deepEqual(spacerSize("right", 3), [1, LANE_GAP * 3 - 40]);
  assert.deepEqual(spacerSize("down", 3), [LANE_GAP * 3 - 40, 1]);
  const lines = d2Source(model, "app", "right", 3, new Set(), { mode: "loose", order: ["svc-pay", "elsewhere, with a long name", "source"] }).split("\n");
  const at = (start: string) => lines.findIndex((l) => l.startsWith(start));
  // two boxes in the out lane: one spacer between them; the in lane holds one box, so none
  assert.equal(lines.filter((l) => l.includes(".lane-gap")).length, 1);
  assert.ok(at(`${LANE_OUT}."svc-pay": `) < at(`${LANE_OUT}.lane-gap1: `) && at(`${LANE_OUT}.lane-gap1: `) < at(`${LANE_OUT}."elsewhere, with a long name": `));
  assert.ok(isSpacer(`${LANE_OUT}.lane-gap1`) && !isSpacer(`${LANE_OUT}."svc-pay"`));
  assert.ok(!d2Source(model, "app", "right", 1, new Set(), { mode: "loose" }).includes("lane-gap"));
});

test("lane: on by default; `lane: false` lays the board out without", async () => {
  const on = (await layoutBoards(model)).app, off = (await layoutBoards(model, { lane: false })).app;
  assert.deepEqual(on, (await layoutBoards(model, { lane: true })).app);
  assert.notDeepEqual(on, off);
});

test("lane: the laid-out lanes sit at the board's edges, in order, with no hard defects", async () => {
  const plain = (await layoutBoards(model, { lane: false })).app, lane = (await layoutBoards(model)).app;
  assert.ok(lane.n.every(([id]) => !id.startsWith("lane-")) && lane.e.every(([a, b]) => !a.startsWith("lane-") && !b.startsWith("lane-")));
  assert.equal(lane.e.length, plain.e.length);
  const xs = lane.n.map((n) => n[1]), ys = lane.n.map((n) => n[2]);
  const direction = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? "right" : "down";
  assert.ok(laneAtEdge(model, "app", lane, direction) || laneAtEdge(model, "app", lane, direction === "right" ? "down" : "right"));
  assert.deepEqual(lintModel(model, { app: lane }).flatMap((l) => l.defects), []);
  assert.equal(laneOrder(model, "app", lane, direction).length, 3);
  // boxes in one lane are as far apart as LANE_GAP, never ELK's tight in-layer gap
  const out = lane.n.filter(([id]) => laneSides(model, "app").get(id) === LANE_OUT);
  assert.equal(out.length, 2);
  const [[, ax, ay, aw, ah], [, bx, by, bw, bh]] = out;
  const gap = Math.max(bx - (ax + aw), ax - (bx + bw), by - (ay + ah), ay - (by + bh));
  assert.ok(gap >= LANE_GAP - 1, `lane gap ${gap}`);
});

// #286: a few parts and more elsewhere boxes that only receive (or, flipped, only send): a lane row
// wider than the parts on a down-flowing board.
const few = ["q1", "q2", "q3"], outs = ["o1", "o2", "o3", "o4", "o5"];
const wideModel = (send: boolean, ps = few, os = outs) => ({
  nodes: Object.fromEntries([
    ["root", node("root", "", ["box", ...os])], ["box", node("box", "root", ps)],
    ...ps.map((p) => [p, node(p, "box")]), ...os.map((o) => [o, node(o, "root")]),
  ]),
  services: {},
  boards: { box: { nodes: [...ps, ...os], context: os, hubs: [], throughout: [], edges: [
    ...ps.slice(1).map((p, i) => edge(ps[i], p)), ...os.map((o, i) => (send ? edge(o, ps[i % ps.length], "call") : edge(ps[i % ps.length], o, "call"))),
  ] } },
}) as unknown as Model;
const wide = wideModel(false), wideIn = wideModel(true);

test("lane rows: a wrapped lane is declared near row then far row, interleaved, with spacers per row and pairing edges", () => {
  for (const [m, side] of [[wide, LANE_OUT], [wideIn, LANE_IN]] as const) {
    const lines = d2Source(m, "box", "down", 3, new Set(), { mode: "rows", order: outs, rows: [side] }).split("\n");
    const decl = lines.filter((l) => l.startsWith(`${side}.`) && l.includes(": ") && !l.includes(" -> ")).map((l) => l.slice(side.length + 1, l.indexOf(": ")));
    assert.deepEqual(decl, ['"o1"', "lane-gap1", '"o3"', "lane-gap2", '"o5"', '"o2"', "lane-gap-f1", '"o4"', "label"]);
    const pair = (n: string, f: string) => (side === LANE_OUT ? `${side}.${n} -> ${side}.${f}` : `${side}.${f} -> ${side}.${n}`);
    for (const [n, f] of [['"o1"', '"o2"'], ['"o3"', '"o4"'], ['"o3"', "lane-gap-f1"]]) assert.ok(lines.includes(pair(n, f)), pair(n, f));
    // the in lane's near row sits below its far row, so its near-row spacers hang off the far row too
    if (side === LANE_IN) assert.ok(lines.includes(`${side}."o2" -> ${side}.lane-gap1`) && lines.includes(`${side}."o4" -> ${side}.lane-gap2`));
    // edge mode's anchoring stays
    assert.ok(lines.includes(side === LANE_OUT ? `"q3" -> ${LANE_OUT}` : `${LANE_IN} -> "q1"`));
    // every edge inside the lane is layout-only
    const inLane = lines.filter((l) => l.startsWith(`${side}.`) && l.includes(" -> ")).map((l) => l.split(" -> ")).filter(([, b]) => b.startsWith(`${side}.`));
    assert.equal(inLane.length, side === LANE_OUT ? 3 : 5);
    assert.ok(inLane.every(([a, b]) => isLaneLayoutEdge(a.replaceAll('"', ""), b.replaceAll('"', ""))));
  }
});

test("lane rows: with no lane to wrap, or under 3 boxes, rows mode is edge mode byte for byte", () => {
  const edgeSrc = d2Source(wide, "box", "down", 3, new Set(), { mode: "edge", order: outs });
  assert.equal(d2Source(wide, "box", "down", 3, new Set(), { mode: "rows", order: outs }), edgeSrc);
  assert.equal(d2Source(wide, "box", "down", 3, new Set(), { mode: "rows", order: outs, rows: [] }), edgeSrc);
  // the out lane is the only one here: asking for the in lane changes nothing
  assert.equal(d2Source(wide, "box", "down", 3, new Set(), { mode: "rows", order: outs, rows: [LANE_IN] }), edgeSrc);
  // the app fixture's out lane has two boxes: too few to wrap
  assert.equal(d2Source(model, "app", "down", 3, new Set(), { mode: "rows", rows: [LANE_OUT] }), d2Source(model, "app", "down", 3, new Set(), { mode: "edge" }));
});

test("lane rows: layout-only edges are those inside one lane or touching a spacer", () => {
  assert.ok(isLaneLayoutEdge(`${LANE_OUT}.n3`, `${LANE_OUT}.n7`));
  assert.ok(isLaneLayoutEdge(`${LANE_IN}.n3`, `${LANE_IN}.n7`));
  assert.ok(!isLaneLayoutEdge("n1", `${LANE_OUT}.n3`));
  assert.ok(!isLaneLayoutEdge(`${LANE_IN}.n1`, `${LANE_OUT}.n3`));
  assert.ok(isLaneLayoutEdge(`${LANE_OUT}.n3`, `${LANE_OUT}.lane-gap-f1`));
  assert.ok(isLaneLayoutEdge(`${LANE_IN}.lane-gap2`, "n1"));
});

test("lane rows: wideLanes picks a lane of 3+ boxes wider than the parts", () => {
  const box = (id: string, x: number, y: number, w = 100): BoardLayout["n"][number] => [id, x, y, w, 50, 0];
  const parts = [box("q1", 200, 0), box("q2", 200, 100), box("q3", 200, 200)];
  const row = (n: number, step: number) => outs.slice(0, n).map((o, i) => box(o, i * step, 300));
  assert.deepEqual(wideLanes(wide, "box", { n: [...parts, ...row(5, 120)], e: [] }), [LANE_OUT]);
  assert.deepEqual(wideLanes(wide, "box", { n: [...parts, ...row(5, 0)], e: [] }), []);
  assert.deepEqual(wideLanes(wide, "box", { n: [...parts, ...row(2, 300)], e: [] }), []);
  assert.deepEqual(wideLanes(wide, "box", { n: row(5, 120), e: [] }), []);
});

test("lane rows: laid out, a wide lane goes on two rows past the parts, with no lane container, spacer or layout-only edge, and no defects", async () => {
  // five parts in a chain and seven boxes: here the picker keeps the two-row candidate
  const ps = ["q1", "q2", "q3", "q4", "q5"], os = ["o1", "o2", "o3", "o4", "o5", "o6", "o7"];
  for (const send of [false, true]) {
    const m = wideModel(send, ps, os);
    const plain = (await layoutBoards(m, { lane: false })).box, lane = (await layoutBoards(m)).box;
    assert.ok(lane.n.every(([id]) => !id.startsWith("lane-")) && lane.e.every(([a, b]) => !a.startsWith("lane-") && !b.startsWith("lane-")));
    assert.equal(lane.e.length, plain.e.length);
    assert.deepEqual(lintModel(m, { box: lane }).flatMap((l) => l.defects), []);
    const box = lane.n.filter(([id]) => os.includes(id)), part = lane.n.filter(([id]) => ps.includes(id));
    if (!send) assert.equal(new Set(box.map((n) => n[2])).size, 2, "two rows");
    if (new Set(box.map((n) => n[2])).size === 2) {
      if (send) assert.ok(box.every((n) => n[2] + n[4] <= Math.min(...part.map((p) => p[2]))));
      else assert.ok(box.every((n) => n[2] >= Math.max(...part.map((p) => p[2] + p[4]))));
    }
  }
});

test("lane rows: ELK lays the two-row source out as a near and a far row past the parts", async () => {
  const pool = d2Pool({});
  try {
    for (const [m, side] of [[wide, LANE_OUT], [wideIn, LANE_IN]] as const) {
      const at = new Map((await pool.compile(d2Source(m, "box", "down", 3, new Set(), { mode: "rows", order: outs, rows: [side] }), "elk")).s.map(([id, , y]) => [id, y]));
      const y = (id: string) => at.get(`${side}.${id}`)!, partYs = few.map((p) => at.get(p)!);
      assert.ok(y("o1") === y("o3") && y("o3") === y("o5") && y("o2") === y("o4") && y("o1") !== y("o2"));
      // the near row is next to the parts, the far row past it
      if (side === LANE_OUT) assert.ok(y("o1") > Math.max(...partYs) && y("o2") > y("o1"));
      else assert.ok(y("o1") < Math.min(...partYs) && y("o2") < y("o1"));
    }
  } finally {
    await pool.close();
  }
});

test("bendsOnly drops repeated points, which would make a zero-length corner", () => {
  assert.deepEqual(bendsOnly([0, 0, 10, 0, 10, 0, 20, 0]), [0, 0, 10, 0, 20, 0]);
  assert.deepEqual(bendsOnly([5, 5, 5, 5]), [5, 5, 5, 5]);
});
