import { test } from "node:test";
import assert from "node:assert/strict";
import { Grouping, type Tour } from "../src/model/schema.ts";
import { resolveTours } from "../src/model/tours.ts";
import { tourStepIssues } from "../src/model/coverage.ts";
import type { Model } from "../src/model/rollup.ts";

const g = (tours: Tour[]) => Grouping.parse({ version: 1, summary: "", children: [{ id: "x", name: "X", summary: "", files: ["a.ts"] }], tours });
const edge = (a: string, b: string, major: boolean) => ({ a, b, imports: 1, calls: 0, uses: 0, major, ev: [] });
const node = (parent: string | null, children: string[] = []) => ({ name: "", summary: "", parent, children, files: [], count: 1, loc: 1 });
const board = (nodes: string[], edges: ReturnType<typeof edge>[]) => ({ nodes, edges, throughout: [], hubs: [], context: [] });

// root lists checkin -> forms and checkin -> db (minor); only checkin's sub-boards draw them
const mk = (deepMajor = true) => ({
  nodes: {
    root: node(null, ["checkin", "forms"]), checkin: node("root", ["kiosk", "queue"]), forms: node("root"),
    kiosk: node("checkin", ["kiosk-ui"]), queue: node("checkin"), "kiosk-ui": node("kiosk"),
  },
  services: { db: "DB" },
  boards: {
    root: board(["checkin", "forms"], [edge("checkin", "forms", false), edge("checkin", "db", false)]),
    checkin: board(["kiosk", "queue"], [edge("kiosk", "queue", true)]),
    kiosk: board(["kiosk-ui", "forms"], [edge("kiosk-ui", "forms", deepMajor)]),
    queue: board(["db"], []),
    "kiosk-ui": board(["db"], []),
  },
}) as unknown as Model;
const steps = (...s: any[]) => g([{ id: "t", title: "T", steps: s }] as Tour[]);

test("tour dive: a group step drawn only on a child board plays there, lighting those arrows", () => {
  const r = resolveTours(steps({ text: "Forms.", edge: ["checkin", "forms"] }), mk());
  assert.deepEqual([r.errors, r.warnings], [[], []]);
  assert.deepEqual(r.tours[0].steps[0], { text: "Forms.", board: "kiosk", lit: { boxes: ["kiosk-ui", "forms"], edges: [["kiosk-ui", "forms"]] } });
});

test("tour dive: a service used throughout lands on the shallowest descendant board that draws it", () => {
  const m = mk() as any;
  m.boards.queue = board(["q", "db"], [edge("q", "db", true)]);
  m.boards["kiosk-ui"] = board(["k", "db"], [edge("k", "db", true)]);
  const r = resolveTours(steps({ text: "Db.", edge: ["checkin", "db"] }), m);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.tours[0].steps[0].board, "queue");
  assert.equal("edge" in r.tours[0].steps[0], false);
  assert.deepEqual(r.tours[0].steps[0].lit, { boxes: ["q", "db"], edges: [["q", "db"]] });
});

test("tour dive: nothing drawn below keeps the listed board, the edge and one warning", () => {
  const r = resolveTours(steps({ text: "Forms.", edge: ["checkin", "forms"] }), mk(false));
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.tours[0].steps[0], { text: "Forms.", board: "root", edge: ["checkin", "forms"] });
});

test("tour dive: a pinned board is never moved or dived", () => {
  const r = resolveTours(steps({ text: "Forms.", edge: ["checkin", "forms"], board: "root" }), mk());
  assert.deepEqual([r.errors, r.warnings], [[], []]);
  assert.deepEqual(r.tours[0].steps[0], { text: "Forms.", board: "root", edge: ["checkin", "forms"] });
});

test("tour dive: coverage passes after the dive and still catches an undrawable step", () => {
  for (const [deep, n] of [[true, 0], [false, 1]] as const) {
    const m = mk(deep);
    m.tours = resolveTours(steps({ text: "Forms.", edge: ["checkin", "forms"] }), m).tours;
    assert.equal(tourStepIssues(m).length, n);
  }
});

test("tour dive: on a real model, a minor group arrow dives to a descendant board that draws it", async () => {
  const { fileURLToPath } = await import("node:url");
  const { analyze } = await import("../src/analyze/index.ts");
  const { assign, defaultGrouping } = await import("../src/model/grouping.ts");
  const { buildModel } = await import("../src/model/rollup.ts");
  const { readdirSync } = await import("node:fs");
  const fx = fileURLToPath(new URL("./fixtures/", import.meta.url));
  let hit: { a: string; b: string; d: string } | undefined;
  let model!: Model;
  for (const name of readdirSync(fx).sort()) {
  if (hit) break;
  const facts = analyze(fx + name);
  const dg = defaultGrouping(facts);
  model = buildModel(facts, dg, assign(dg, facts).leafOf);
  for (const [bid, bd] of Object.entries(model.boards)) for (const e of bd.edges) {
    if (!e.major || !bd.nodes.includes(e.a) || !bd.nodes.includes(e.b) || !model.nodes[e.a]?.children.length) continue;
    const below = (id: string): string | undefined => model.nodes[id].children.find((c) => model.boards[c]?.edges.some((x) => x.major && x.a !== e.a && x.b === e.b && model.boards[c].nodes.includes(x.a) && model.boards[c].nodes.includes(x.b))) ?? model.nodes[id].children.map(below).find(Boolean);
    const d = below(e.a);
    if (d) { hit = { a: e.a, b: e.b, d }; break; }
  }
  }
  if (!hit) return; // no fixture has such a shape: the hand-built cases above cover it
  const m = structuredClone(model);
  for (const bd of Object.values(m.boards)) for (const e of bd.edges) if (e.a === hit.a && e.b === hit.b) e.major = false;
  const r = resolveTours(steps({ text: "Go.", edge: [hit.a, hit.b] }), m);
  assert.deepEqual([r.errors, r.warnings], [[], []]);
  assert.equal("edge" in r.tours[0].steps[0], false);
  m.tours = r.tours;
  assert.deepEqual(tourStepIssues(m), []);
});
