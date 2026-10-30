// The dial's layers (#327): which group boards exist at a budget, and where a board that doesn't exist lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { cut, extraBoxes } from "../src/viewer/budget.ts";
import { hasLayer, holdOn, layerOf, layers, upOf } from "../src/viewer/layers.ts";
import { STORY, type ViewerData } from "../src/viewer/state.ts";

const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));
const grouping = (story: boolean) => Grouping.parse({
  ...JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")),
  ...(story ? { story: {
    actors: [{ id: "customer", name: "Customer", summary: "Pays invoices.", kind: "person" }],
    uses: [{ actor: "customer", part: "app", says: "opens the app", entry: "src/app/shell/main.ts" }],
    narrative: ["A [[customer]] opens the [[app]]."],
  } } : {}),
});
async function page(story: boolean): Promise<ViewerData> {
  const g = grouping(story), facts = analyze(dir), a = assign(g, facts);
  const model = buildModel(facts, g, a.leafOf);
  return pageData(renderHtml(model, await layoutBoards(model)));
}

test("layers: Default and Simple keep every board; the tops always exist", async () => {
  for (const d of [await page(false), await page(true)]) {
    for (const id of Object.keys(d.nodes)) assert.ok(hasLayer(d, 0, id), id);
    assert.ok(hasLayer(d, Infinity, "root"));
    assert.ok(hasLayer(d, Infinity, STORY));
  }
});

test("layers: the top stop is one board; a middle stop keeps the boards a surviving board draws closed", async () => {
  const d = await page(false);
  assert.deepEqual([...layers(d, Infinity)], ["root"]);
  assert.ok(!hasLayer(d, Infinity, "pdf"));
  // budget 5: root's two parts open, app's three... whichever stay closed on a board that exists have a board
  const tree = d.tree ?? d.nodes;
  for (const budget of [3, 5, 8, 12]) {
    const ls = layers(d, budget);
    for (const b of ls) {
      const c = cut(tree, d.paths, b, budget, { extra: extraBoxes(d.nodes, d.boards[b], b) });
      for (const x of c.boxes) if (x[0] !== "@" && tree[x] && (tree[x].children.length || tree[x].files.length)) assert.ok(ls.has(x), `${x} closed on ${b} at ${budget}`);
      for (const x of Object.keys(c.open)) if (x !== b) assert.ok(!ls.has(x) || x === "root", `${x} is a container on ${b} at ${budget}`);
    }
  }
});

test("layers: the nearest board that exists is the id itself, else its nearest ancestor, else the top", async () => {
  const d = await page(false);
  assert.equal(layerOf(d, 0, "pdf"), "pdf");
  assert.equal(layerOf(d, Infinity, "pdf"), "root");
  assert.equal(upOf(d, "app"), "root");
  assert.equal(upOf(d, "root"), null);
  const s = await page(true);
  assert.equal(upOf(s, "app"), STORY, "a level-1 part's parent is the Overview on a story page");
  assert.equal(layerOf(s, Infinity, "pdf"), STORY, "from anywhere, More lands on the Overview");
  assert.equal(layerOf(s, Infinity, "app"), STORY);
});

test("layers: a place maps onto the box that holds it on the new board", async () => {
  const d = await page(false);
  assert.equal(holdOn(d, Infinity, "root", "n:pdf"), "n:pdf", "on the top board a group is a container: it holds itself");
  assert.equal(holdOn(d, Infinity, "root", "n:root"), null, "the board itself is no box");
  assert.equal(holdOn(d, Infinity, "root", null), null);
  assert.equal(holdOn(d, 3, "root", "n:pdf-render")?.startsWith("n:"), true);
});

test("layers: a script's stop change onto a board with no layer selects the box holding it (#327)", async () => {
  const d = await page(false);
  for (const budget of [3, 5, 8]) {
    const to = layerOf(d, budget, "pdf");
    if (to === "pdf") continue;
    const h = holdOn(d, budget, to, "n:pdf");
    assert.ok(h, `pdf is held by a box or container on ${to} at ${budget}`);
  }
  assert.equal(layerOf(d, Infinity, "pdf"), "root");
  assert.equal(holdOn(d, Infinity, "root", "n:pdf"), "n:pdf");
});
