// The story level (Overview) turns with the detail dial (#184): at a budget stop it is the root's
// cut with the actors in a column on its left (viewer/storycut.ts). elkjs runs in Node in place of
// the page's Worker.
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
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { STORY, type ViewerData } from "../src/viewer/state.ts";
import { stopsFor } from "../src/viewer/budget.ts";
import { storyLayout } from "../src/viewer/storycut.ts";
import { sayBox } from "../src/viewer/figures.ts";

const elk = new (bundled as unknown as new () => ElkApi)();
const run = (g: ElkNode) => elk.layout(g);
const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));

let cached: ViewerData | null = null;
async function deepWithStory(): Promise<ViewerData> {
  if (cached) return cached;
  const g = Grouping.parse({
    ...JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")),
    story: {
      actors: [{ id: "customer", name: "Customer", summary: "Pays invoices.", kind: "person" }],
      uses: [{ actor: "customer", part: "app", says: "opens the app", entry: "src/app/shell/main.ts" }],
      narrative: ["A [[customer]] opens the [[app]]."],
    },
  });
  const facts = analyze(dir);
  const a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  const model = buildModel(facts, g, a.leafOf);
  return (cached = pageData(renderHtml(model, await layoutBoards(model))));
}

const sig = (d: ViewerData, budget: number) => {
  const b = storyLayout(d, budget, run).board;
  return `${b.nodes.join(",")}|${Object.entries(b.inside ?? {}).sort().join(";")}`;
};

test("Overview differs between Default, a middle stop and Everything", async () => {
  const d = await deepWithStory();
  // deep is too small for a real +1 stop (it gets Default and Everything only), so a middle budget
  // stands in: the root's 2 parts and the actor, with room to open one level of the app
  assert.deepEqual(stopsFor(d.tree ?? d.nodes, d.paths).map((s) => s.key), ["everything", "default"]);
  assert.equal(storyLayout(d, 0, run).board, d.boards[STORY], "Default is the story as built");
  const def = sig(d, 0), one = sig(d, 5), all = sig(d, Infinity);
  assert.notEqual(one, def);
  assert.notEqual(all, one);
  // Everything opens to files: every file is drawn
  const every = storyLayout(d, Infinity, run).board;
  assert.equal(every.nodes.filter((id) => id[0] === "@").length, d.paths.length);
});

test("a cut story keeps its actors and their arrows on its top level", async () => {
  const d = await deepWithStory();
  const b = storyLayout(d, Infinity, run).board;
  assert.equal(b.cut?.board, STORY);
  assert.equal(b.inside!.customer, STORY);
  assert.equal(b.inside!.app, STORY, "a story part is a container on the story's top level");
  assert.ok(!Object.values(b.inside!).includes("root"), "the root is the story itself");
  const told = b.edges.find((e) => e.a === "customer");
  assert.deepEqual([told?.b, told?.says], ["app", ["opens the app"]]);
});

test("a cut story's layout: actors in a column left of the parts, each arrow drawn", async () => {
  const d = await deepWithStory();
  const got = storyLayout(d, Infinity, run);
  const l = await got.laid;
  const at = new Map(l.n.map(([id, x, y, w, h]) => [id, { x, y, w, h }]));
  const actor = at.get("customer")!;
  for (const [id, r] of at) if (id !== "customer") assert.ok(r.x > actor.x + actor.w, `${id} is right of the actors`);
  const wire = l.e.find(([a, b]) => a === "customer" && b === "app");
  assert.ok(wire, "the actor's arrow is routed");
  const p = wire!.slice(3) as number[];
  assert.equal(p[0], actor.x + actor.w, "it leaves the actor's right side");
  assert.equal(p[1], p[3], "straight, with room for its pill");
  for (const e of got.board.edges) assert.ok(l.e.some(([a, b]) => a === e.a && b === e.b), `${e.a}>${e.b} drawn`);
});

test("a cut story's services sit at the board's edge (right, or bottom on a tall canvas), the actors on the left (#183)", async () => {
  const d = await deepWithStory();
  for (const aspect of [1.6, 0.5]) {
    const got = storyLayout(d, Infinity, run, { aspect }), l = await got.laid, b = got.board;
    const svc = b.nodes.filter((id) => b.inside?.[id] === STORY && (d.services[id] || b.context.includes(id)));
    assert.ok(svc.length, "the story has services");
    const at = new Map(l.n.map(([id, x, y, w, h]) => [id, { x, y, w, h }]));
    const parts = l.n.filter(([id]) => !svc.includes(id) && id !== "customer");
    const right = Math.max(...parts.map(([, x, , w]) => x + w)), bottom = Math.max(...parts.map(([, , y, , h]) => y + h));
    for (const id of svc) assert.ok(aspect > 1 ? at.get(id)!.x > right : at.get(id)!.y > bottom, `${id} at the ${aspect > 1 ? "right" : "bottom"} edge`);
    const actor = at.get("customer")!;
    for (const [id, r] of at) if (id !== "customer") assert.ok(r.x > actor.x + actor.w, `${id} right of the actor at ${aspect}`);
  }
});

test("a cut story's actor with two arrows: their pills stack beside it without overlapping (#263)", async () => {
  const g = Grouping.parse({
    ...JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")),
    story: {
      actors: [{ id: "customer", name: "Customer", summary: "Pays invoices.", kind: "person" }],
      uses: [
        { actor: "customer", part: "app", says: "opens the app", entry: "src/app/shell/main.ts" },
        { actor: "customer", part: "api", says: "calls the server", entry: "src/api/server.ts" },
        { actor: "customer", part: "api", says: "checks an invoice", entry: "src/api/server.ts" },
      ],
      narrative: ["A [[customer]] opens the [[app]]."],
    },
  });
  const facts = analyze(dir), a = assign(g, facts), model = buildModel(facts, g, a.leafOf);
  const d = pageData(renderHtml(model, await layoutBoards(model)));
  const got = storyLayout(d, Infinity, run), l = await got.laid;
  const [, , ay, , ah] = l.n.find(([id]) => id === "customer")!;
  const pills = got.board.edges.filter((e) => e.a === "customer").map((e) => {
    const p = l.e.find(([x, y]) => x === e.a && y === e.b)!.slice(3) as number[];
    return { y: p[1], h: sayBox(e.says!)[1] };
  }).sort((p, q) => p.y - q.y);
  assert.deepEqual(pills.map((p) => p.h).sort(), [24, 40], "one pill on two lines, one on one");
  assert.ok(pills[1].y - pills[0].y >= (pills[0].h + pills[1].h) / 2 + 4, JSON.stringify(pills));
  for (const p of pills) assert.ok(p.y > ay && p.y < ay + ah, "each arrow leaves inside the card");
});
