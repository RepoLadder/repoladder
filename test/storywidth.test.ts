// The story level's name size follows its width, not its box count (#236): long part names go on two
// lines, a lone arrow's long phrase too, and the budget says which phrase to shorten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Story } from "../src/model/schema.ts";
import { boxSizes, layoutBoards } from "../src/build/layout.ts";
import { railOf } from "../src/build/boxsize.ts";
import { laneWidth } from "../src/build/storylayout.ts";
import { lintBoard } from "../src/build/lint.ts";
import { budgetBoard, storyHint } from "../src/build/budget.ts";
import { nameLines, nameWidth, splitName } from "../src/viewer/namewrap.ts";
import { sayBox, sayLines, soleSay } from "../src/viewer/figures.ts";
import { boxBody } from "../src/viewer/shapes.ts";
import { STORY } from "../src/viewer/state.ts";

test("splitName: the split whose longer line is shortest; one word stays whole", () => {
  assert.deepEqual(splitName("Articles, comments & tags"), ["Articles,", "comments & tags"]);
  assert.deepEqual(splitName("Server & database setup"), ["Server &", "database setup"]);
  assert.equal(splitName("Server"), null);
});

test("nameLines: one line when the name fits the box, else its split", () => {
  const name = "Articles, comments & tags";
  assert.deepEqual(nameLines(name, nameWidth(name)), [name]);
  assert.deepEqual(nameLines(name, nameWidth(name) - 10), ["Articles,", "comments & tags"]);
  // the backend rail takes room from the text
  assert.deepEqual(nameLines(name, nameWidth(name), 12), ["Articles,", "comments & tags"]);
  assert.deepEqual(nameLines("Server", 50), ["Server"]);
});

test("boxBody draws a split name as two lines, and keeps one-line names as they were", () => {
  const box = { x: 0, y: 0, w: 200, h: 76, name: "Articles, comments & tags", subs: ["8 files · 600 lines"] };
  const two = boxBody({ ...box, lines: ["Articles,", "comments & tags"] });
  assert.equal(two.match(/<text class="name"/g)!.length, 2);
  assert.match(two, />comments &amp; tags</);
  const one = boxBody(box);
  assert.equal(one.match(/<text class="name"/g)!.length, 1);
  assert.equal(boxBody({ ...box, lines: [box.name] }), one);
});

test("sayLines: only an actor's only arrow splits its long phrases, and never past three lines", () => {
  assert.deepEqual(sayLines(["reads articles and browses tags"]), ["reads articles and browses tags"]);
  assert.deepEqual(sayLines(["reads articles and browses tags"], true), ["reads articles", "and browses tags"]);
  assert.deepEqual(sayLines(["checks in"], true), ["checks in"]);
  assert.equal(sayLines(["writes and edits posts", "reads the blog and docs"], true).length, 3);
  assert.ok(sayBox(["reads articles and browses tags"], true)[0] < sayBox(["reads articles and browses tags"])[0]);
  const edges = [{ a: "amy", says: ["x"] }, { a: "amy", says: ["y"] }, { a: "bob", says: ["z"] }, { a: "bob" }];
  assert.equal(soleSay(edges, "amy"), false);
  assert.equal(soleSay(edges, "bob"), true);
  // the lane is as wide as the widest pill as drawn
  assert.ok(laneWidth([{ a: "bob", says: ["reads articles and browses tags"] }]) < laneWidth([{ a: "bob", says: ["reads articles and browses tags"] }, { a: "bob", says: ["x"] }]));
});

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const LONG: Record<string, string> = { web: "Articles, comments & tags", functions: "Server & database setup", "multi-root": "Profiles & following", tools: "Accounts & sign-in" };
const story = (says: [string, string]): Story => ({
  actors: [
    { id: "reader", name: "Reader", summary: "Reads.", kind: "person" },
    { id: "writer", name: "Writer", summary: "Writes.", kind: "person" },
  ],
  uses: [
    { actor: "reader", part: "web", says: says[0], entry: "web/src/main.ts" },
    { actor: "writer", part: "functions", says: says[1], entry: "pingHttp" },
    { actor: "writer", part: "web", says: "edits", entry: "web/src/main.ts" },
  ],
  narrative: ["A [[reader]] and a [[writer]]."],
});
const modelOf = (says: [string, string]) => {
  const d = defaultGrouping(multi);
  const g = Grouping.parse({ ...d, children: d.children.map((c) => ({ ...c, name: LONG[c.id] ?? c.name })), story: story(says) });
  return buildModel(multi, g, assign(g, multi).leafOf);
};

test("story parts sized for two-line names are narrower and a line taller", () => {
  const model = modelOf(["reads", "writes"]);
  const one = boxSizes(model, STORY), two = boxSizes(model, STORY, false, true);
  assert.ok(two.web[0] < one.web[0], `${two.web[0]} < ${one.web[0]}`);
  assert.ok(two.web[1] > one.web[1]);
  // actors and services keep their sizes; other boards never wrap
  assert.deepEqual(two.reader, one.reader);
  assert.deepEqual(boxSizes(model, "root"), boxSizes(model, "root", false));
});

test("the story layout draws long part names on two lines when that reads bigger, with no defects", async () => {
  const model = modelOf(["reads", "writes"]);
  const lay = (await layoutBoards(model, { only: [STORY] }))[STORY];
  const lint = lintBoard(model, STORY, lay);
  assert.deepEqual(lint.defects, []);
  const parts = lay.n.filter(([id]) => LONG[id]);
  assert.ok(parts.length >= 2);
  const narrow = boxSizes(model, STORY, false, true).web[0];
  for (const [id, , , w] of parts) assert.equal(w, narrow, `${id} has the two-line width`);
  assert.ok(parts.some(([id, , , w]) => nameLines(LONG[id], w, railOf(model, id)).length === 2));
});

test("budget: a story with small names quotes the longest phrase to shorten", () => {
  const model = modelOf(["reads articles and browses tags", "publishes articles and comments"]);
  // the reader's lone phrase goes on two lines; the writer has two arrows, so its phrase stays whole
  assert.match(storyHint(model), /"publishes articles and comments", to 20 characters or less/);
  assert.equal(storyHint(modelOf(["reads", "writes"])), " (the story is too wide)");
  // two boxes 6000px apart: the names come out far too small
  const layout = { n: [["reader", 0, 0, 120, 56, 0], ["web", 6000, 0, 120, 58, 0]] as [string, number, number, number, number, 0 | 1][], e: [] };
  const b = budgetBoard(model, layout, lintBoard(model, STORY, layout));
  assert.equal(b.kind, "story");
  assert.match(b.over[0].detail, /^names [\d.]+px < 11\.5px \(the story is too wide: shorten what actors do, "publishes articles and comments"/);
});
