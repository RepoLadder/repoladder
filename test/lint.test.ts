// Layout lint (#68): defects measured on the drawn geometry, neatness metrics, and every fixture build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { Grouping, type Story } from "../src/model/schema.ts";
import { boxSizes, d2Source, layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { STACK_PAD, drawnBoxes, isStacked, snapEnds, snapWires, throughWires } from "../src/build/outline.ts";
import { lintBoard, lintModel, summarizeLint, worstBoards } from "../src/build/lint.ts";
import { STORY } from "../src/viewer/state.ts";
import { renderIndex } from "../scripts/gallery.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const build = (name: string, story?: Story): Model => {
  const facts = analyze(fixtures + name);
  const g = Grouping.parse({ ...defaultGrouping(facts), ...(story ? { story } : {}) });
  return buildModel(facts, g, assign(g, facts).leafOf);
};
// root of multi: web (openable, so drawn with two stacked cards), functions, tools, multi-root, two services
const multi = build("multi");
type N = BoardLayout["n"][number];
const far: N[] = [["multi-root", 0, 400, 160, 60, 0], ["svc-firebase", 300, 400, 120, 80, 1], ["svc-stripe", 600, 400, 120, 80, 1]];
const lay = (n: N[], e: BoardLayout["e"]): BoardLayout => ({ n: [...n, ...far], e });
const kinds = (l: ReturnType<typeof lintBoard>) => l.defects.map((d) => d.kind);

test("lint: a clean board has no defects", () => {
  const l = lintBoard(multi, "root", lay([["web", 0, 0, 160, 60, 0], ["functions", 300, 0, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]], [["web", "functions", 0, 160, 30, 300, 30]]));
  assert.deepEqual(l.defects, []);
  assert.equal(l.metrics.direction, "right");
  assert.equal(l.metrics.crossings, 0);
  assert.equal(l.metrics.bendsPerEdge, 0);
});

test("lint: overlapping boxes, including a box's stacked cards", () => {
  assert.deepEqual(kinds(lintBoard(multi, "root", lay([["web", 0, 0, 160, 60, 0], ["functions", 100, 20, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]], []))), ["overlap"]);
  // web's cards reach 8px past its box, into functions
  assert.deepEqual(kinds(lintBoard(multi, "root", lay([["web", 0, 0, 160, 60, 0], ["functions", 164, 0, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]], []))), ["overlap"]);
});

test("lint: an arrow that stops short, and one whose head hides under stacked cards", () => {
  const boxes: N[] = [["web", 0, 0, 160, 60, 0], ["functions", 300, 0, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]];
  const short = lintBoard(multi, "root", lay(boxes, [["web", "functions", 0, 160, 30, 290, 30]]));
  assert.deepEqual(short.defects.map((d) => d.detail), ["stops 10px short of functions"]);
  // tools → web arrives at web's bottom edge, which its cards cover by 8px
  const hidden = lintBoard(multi, "root", lay(boxes, [["tools", "web", 0, 80, 200, 80, 60]]));
  assert.deepEqual(hidden.defects.map((d) => d.detail), ["arrowhead 8px inside web"]);
  // a tail under its own box is fine: boxes are drawn over wires
  assert.deepEqual(lintBoard(multi, "root", lay(boxes, [["web", "functions", 0, 150, 30, 300, 30]])).defects, []);
});

test("lint: a wire through a box that is not its end", () => {
  const l = lintBoard(multi, "root", lay([["web", 0, 0, 160, 60, 0], ["functions", 600, 0, 160, 60, 0], ["tools", 250, 0, 160, 60, 0]], [["web", "functions", 0, 160, 30, 600, 30]]));
  assert.ok(l.defects.some((d) => d.kind === "through" && d.ids[2] === "tools"));
});

test("lint: a cylinder's curved lid is its border", () => {
  const boxes: N[] = [["web", 0, 0, 160, 60, 0], ["functions", 600, 0, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]];
  const svc: N = ["svc-firebase", 300, 400, 120, 80, 1];
  // into the lid's middle (its top) and near its side, where the lid has curved down 8px
  const mid = lintBoard(multi, "root", { n: [...boxes, svc, far[0], far[2]], e: [["web", "svc-firebase", 0, 80, 60, 80, 300, 360, 300, 360, 400]] });
  assert.deepEqual(mid.defects.filter((d) => d.kind === "endpoint"), []);
  const side = lintBoard(multi, "root", { n: [...boxes, svc, far[0], far[2]], e: [["web", "svc-firebase", 0, 80, 60, 80, 300, 303, 300, 303, 400]] });
  assert.match(side.defects.find((d) => d.kind === "endpoint")?.detail ?? "", /stops [\d.]+px short of svc-firebase/);
});

test("lint: actor arrows are measured to the drawn card", () => {
  const story: Story = {
    actors: [{ id: "customer", name: "Customer", summary: "Uses the app.", kind: "person" }],
    uses: [{ actor: "customer", part: "web", says: "opens the app", entry: "web/src/main.ts" }],
    narrative: ["A [[customer]] opens the [[web]]."],
  };
  const m = build("multi", story);
  const n: N[] = m.story!.board.nodes.map((id, i) => (id === "customer" ? [id, 0, 0, 160, 56, 0] : id === "web" ? [id, 400, 0, 160, 60, 0] : [id, 400 + 300 * i, 300, 160, 60, 0]) as N);
  assert.deepEqual(lintBoard(m, STORY, { n, e: [["customer", "web", 0, 160, 28, 400, 28]] }).defects, []);
  const gap = lintBoard(m, STORY, { n, e: [["customer", "web", 0, 180, 28, 400, 28]] });
  assert.deepEqual(gap.defects.map((d) => d.detail), ["starts 20px short of customer"]);
});

test("lint: alignment, width spread, bends and the summary", () => {
  const l = lintBoard(multi, "root", lay([["web", 0, 0, 160, 60, 0], ["functions", 300, 0, 160, 60, 0], ["tools", 0, 200, 200, 60, 0]], [["web", "functions", 0, 160, 30, 230, 30, 230, 10, 300, 10]]));
  // web and tools share a column and a left edge; svc-firebase and functions overlap too little to be one layer
  assert.ok(l.metrics.aligned >= 2);
  assert.ok(l.metrics.widthCV.service === 0);
  assert.equal(l.metrics.bendsPerEdge, 2);
  assert.ok(l.metrics.namePx > 0 && l.metrics.wasted > 0 && l.metrics.wasted < 1);
  const s = summarizeLint([l, { ...l, board: "x", defects: [{ kind: "endpoint", ids: [], detail: "" }] }]);
  assert.equal(s.defectBoards, 1);
  assert.equal(s.defects.endpoint, 1);
  assert.equal(worstBoards([l, { ...l, board: "x", defects: [{ kind: "endpoint", ids: [], detail: "" }] }])[0].board, "x");
});

test("gallery index shows the lint per repo and names the boards with defects", () => {
  const lint = { boards: 3, defectBoards: 1, defects: { overlap: 0, endpoint: 2, label: 0, through: 0, clipped: 0 }, aligned: 0.9, crossings: 4, overlapWires: 0, bendsPerEdge: 1.2, namePx: 12.5, wasted: 0.6, orphans: 0, cylGap: null, worst: ["_story (2)"] };
  const html = renderIndex([{ name: "app", shape: "", source: "local", sha: null, local: true, status: "ok", grouping: "default", warnings: [], lint }], { repoladderSha: "c".repeat(40), totalMs: 1 });
  assert.ok(html.includes("<th class=\"n\" title=\"layout lint: boards with hard defects"));
  assert.ok(html.includes("boards with hard defects: _story (2)"));
  assert.ok(html.includes("1/3 boards with defects (2 endpoint)"));
});

// Fixture builds: no hard defects. Known failures are todo, with what fixes them.
const KNOWN: Record<string, string> = {};

const cases: [string, () => Model][] = [
  ...readdirSync(fixtures).sort().map((f): [string, () => Model] => [f, () => build(f)]),
  ["multi+story", () => build("multi", {
    actors: [{ id: "customer", name: "Customer", summary: "Uses the app.", kind: "person" }, { id: "cron", name: "Health check", summary: "Pings the server.", kind: "system" }],
    uses: [{ actor: "customer", part: "web", says: "opens the app", entry: "web/src/main.ts" }, { actor: "cron", part: "functions", says: "checks it is up", entry: "pingHttp" }],
    narrative: ["A [[customer]] opens the [[web|web app]].", "A [[cron]] keeps watch."],
  })],
];

for (const [name, make] of cases) {
  test(`lint: fixture ${name} lays out without hard defects`, async (t) => {
    const model = make();
    for (const l of lintModel(model, await layoutBoards(model))) {
      const known = KNOWN[`${name}/${l.board}`];
      await t.test(l.board, { todo: known }, () => assert.deepEqual(l.defects.map((d) => `${d.kind}: ${d.detail}`), []));
      // #126: a box with a connection on its board keeps at least one drawn arrow
      await t.test(`${l.board}: no orphans`, () => assert.deepEqual(l.metrics.orphans, []));
      // #497: no two arrows are drawn on top of each other
      await t.test(`${l.board}: no overlapping wires`, () => assert.equal(l.metrics.overlapWires, 0));
    }
  });
}

// #85: the layout makes room for stacked cards and ends every wire on what the viewer draws.
test("outline: wire ends move onto stacked cards and cylinder lids, along their last segment", () => {
  const boxes: N[] = [["web", 0, 0, 160, 60, 0], ["functions", 300, 0, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]];
  const parts = new Map(drawnBoxes(multi, "root", [...boxes, far[1]]).map((d) => [d.id, d.parts]));
  // up into web's bottom edge: the cards reach 8px lower, so the arrow stops there
  assert.deepEqual(snapEnds([80, 200, 80, 60], parts.get("tools"), parts.get("web")), [80, 200, 80, 68]);
  // down into a cylinder near its side, where the lid has curved down: the arrow grows to meet it
  const [, , x, y] = snapEnds([303, 300, 303, 400], undefined, parts.get("svc-firebase"));
  assert.equal(x, 303);
  assert.ok(y > 400 && y < 410, String(y));
  // a tail that starts under its box moves out to the border (the cards' right edge)
  assert.deepEqual(snapEnds([150, 30, 300, 30], parts.get("web"), parts.get("functions")), [168, 30, 300, 30]);
  // and the lint agrees
  assert.deepEqual(lintBoard(multi, "root", snapWires(multi, "root", lay(boxes, [["tools", "web", 0, 80, 200, 80, 60]]))).defects, []);
});

test("outline: openable boxes are stacked; context boxes and plain services are not", () => {
  assert.ok(isStacked(multi, "root", "web"));
  assert.ok(!isStacked(multi, "root", "svc-firebase"));
  const ctx = Object.entries(multi.boards).flatMap(([b, x]) => x.context.map((c) => [b, c]));
  assert.ok(ctx.length && ctx.every(([b, c]) => !isStacked(multi, b, c)));
});

test("layout: D2 reserves room for an openable box's cards, and the box drawn is its front card", async () => {
  const sizes = boxSizes(multi, "root");
  assert.match(d2Source(multi, "root"), new RegExp(`^"web": "" \\{ width: ${sizes.web[0] + STACK_PAD}; height: ${sizes.web[1] + STACK_PAD} \\}$`, "m"));
  const l = await layoutBoards(multi);
  const web = l.root.n.find((n) => n[0] === "web")!;
  assert.deepEqual([web[3], web[4]], sizes.web);
});

test("outline: a wire through a box that is not its end", () => {
  const l = lay([["web", 0, 0, 160, 60, 0], ["functions", 600, 0, 160, 60, 0], ["tools", 250, 0, 160, 60, 0]], [["web", "functions", 0, 160, 30, 600, 30], ["web", "tools", 0, 160, 50, 250, 50]]);
  assert.deepEqual([...throughWires(multi, "root", l)], ["web>functions"]);
});

test("lint: a box with a connection but no drawn wire is an orphan; one with none is not", () => {
  const boxes: N[] = [["web", 0, 0, 160, 60, 0], ["functions", 300, 0, 160, 60, 0], ["tools", 0, 200, 160, 60, 0]];
  const linked = new Set(multi.boards.root.edges.filter((e) => !multi.boards.root.throughout.includes(e.b)).flatMap((e) => [e.a, e.b]));
  const l = lintBoard(multi, "root", lay(boxes, []));
  assert.deepEqual(l.metrics.orphans, [...linked].filter((id) => [...boxes, ...far].some(([b]) => b === id)).sort());
  assert.ok(l.metrics.orphans.length > 0);
  assert.equal(summarizeLint([l]).orphans, l.metrics.orphans.length);
});
