// The trail during a tour (#196): which levels light up, and the step's path in the strip.
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
import { resolveTours } from "../src/model/tours.ts";
import { st } from "../src/viewer/state.ts";
import { commonLevel, passedBoards, stepPath } from "../src/viewer/tourtrail.ts";

const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));
const facts = analyze(dir);
const grouping = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);
model.tours = resolveTours(grouping, model).tours;
st.data = pageData(renderHtml(model, await layoutBoards(model)));

test("the common level of two boards is their deepest shared parent", () => {
  assert.equal(commonLevel("pdf-render", "plans"), "billing");
  assert.equal(commonLevel("pdf", "pdf-render"), "pdf");
  assert.equal(commonLevel("app", "root"), "root");
});

test("passed boards are the steps' boards so far plus the levels climbed between branches", () => {
  const boards = ["app", "pdf", "root"];
  assert.deepEqual([...passedBoards(boards, 0)].sort(), ["app"]);
  // app → pdf goes straight down: the common level is app itself
  assert.deepEqual([...passedBoards(boards, 1)].sort(), ["app", "pdf"]);
  assert.deepEqual([...passedBoards(boards, 2)].sort(), ["app", "pdf", "root"]);
  // across branches, the move climbs through their common parent
  assert.deepEqual([...passedBoards(["pdf-render", "plans"], 1)].sort(), ["billing", "pdf-render", "plans"]);
  // stepping back un-lights what comes later
  assert.deepEqual([...passedBoards(boards, 1)].includes("root"), false);
});

test("a step's path is the levels below the overview, then the part it's in", () => {
  const name = (id: string) => st.data.nodes[id].name;
  assert.deepEqual(stepPath({ board: "root", lit: { boxes: ["app"], edges: [] } }), ["Overview", name("app")]);
  const p = stepPath({ board: "pdf", lit: { boxes: [], edges: [["pdf-render", "pdf-layout"]] } });
  assert.deepEqual(p, [name("app"), name("billing"), name("invoices"), name("pdf"), name("pdf-render")]);
  // a step on the board itself ends at the board
  assert.deepEqual(stepPath({ board: "app", lit: { boxes: ["app"], edges: [] } }), [name("app")]);
});
