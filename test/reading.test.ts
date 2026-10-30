import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardLayout } from "../src/build/layout.ts";
import type { PageEdge } from "../src/viewer/state.ts";
import { caption, flowOf, layersOf, list, rankOf, readLit, stepsOf, sumUp } from "../src/viewer/readorder.ts";
import { buildViewer } from "../src/build/viewer.ts";

const box = (id: string, x: number, y: number, w = 100, h = 40): BoardLayout["n"][number] => [id, x, y, w, h, 0];
const edge = (a: string, b: string): PageEdge => ({ a, b, imports: 1, calls: 0, uses: 0, major: true, ev: [] });

// Page -> 6 screens + http; Redirect -> http; http -> backend (right-flowing, three columns)
const screens = ["AScreen", "BScreen", "CScreen", "DScreen", "EScreen", "FScreen"];
const right: BoardLayout = {
  n: [box("Page", 0, 100), box("Redirect", 0, 300), ...screens.map((s, i) => box(s, 200, i * 50)), box("http", 205, 320), box("backend", 400, 320)],
  e: [...screens.map((s) => ["Page", s, 0, 100, 120, 200, i(s)] as BoardLayout["e"][number]), ["Page", "http", 0, 100, 120, 205, 340], ["Redirect", "http", 0, 100, 320, 205, 340], ["http", "backend", 0, 305, 340, 400, 340]],
};
function i(s: string) { return screens.indexOf(s) * 50 + 20; }

test("reading: flow direction follows the arrows", () => {
  assert.equal(flowOf(right), "right");
  const down: BoardLayout = { n: right.n.map(([id, x, y, w, h, c]) => [id, y, x, h, w, c]), e: right.e.map(([a, b, c, ...p]) => [a, b, c, ...p]) };
  assert.equal(flowOf(down), "down");
  assert.deepEqual(layersOf(down)[0], ["Page", "Redirect"]);
});

test("reading: layers are columns of overlapping boxes, top to bottom", () => {
  assert.deepEqual(layersOf(right), [["Page", "Redirect"], [...screens, "http"], ["backend"]]);
});

test("reading: a big layer is read in chunks by the earlier box that leads to it", () => {
  // 7 boxes in the middle column, all reached first from Page: one chunk, past STEP_MAX
  assert.deepEqual(stepsOf(right), [["Page", "Redirect"], [...screens, "http"], ["backend"]]);
  // the same column split between two sources: Page's screens, then Redirect's boxes
  const split: BoardLayout = { ...right, e: [...right.e.filter(([a, b]) => !(a === "Page" && (b === "EScreen" || b === "FScreen"))), ["Redirect", "EScreen", 0], ["Redirect", "FScreen", 0]] };
  assert.deepEqual(stepsOf(split), [["Page", "Redirect"], ["AScreen", "BScreen", "CScreen", "DScreen", "http"], ["EScreen", "FScreen"], ["backend"]]);
});

test("reading: a step lights its layer, its arrows and where they come from; earlier steps dim", () => {
  const rank = rankOf(stepsOf(right));
  const arrows = ["Page>AScreen", "Redirect>http", "http>backend"];
  const on = (k: number) => { const l = readLit(rank, arrows, k); return [...l.boxes.sort(), ...l.arrows]; };
  assert.deepEqual(on(0), ["Page", "Redirect"]);
  assert.ok(on(1).includes("Page>AScreen") && on(1).includes("Page"), "the box an arrow of this step starts from is lit again");
  assert.ok(!on(1).includes("backend"));
  assert.deepEqual(on(2), ["backend", "http", "http>backend"], "earlier layers fade back with the rest");
});

test("reading: names are summed up by their last word, and long lists are cut", () => {
  assert.equal(list(["a"]), "a");
  assert.equal(list(["a", "b", "c"]), "a, b and c");
  assert.equal(sumUp([...screens.map((s) => `${s}.tsx`), "kioskHttp"]), "6 screens and kioskHttp");
  assert.equal(sumUp(["a", "b", "c", "d", "e", "f"]), "a, b, c and 3 more");
});

test("reading: captions say what the step's arrows do, from the edges only", () => {
  const steps = stepsOf(right);
  const edges = right.e.map(([a, b]) => edge(a, b));
  const shown = new Set(edges.map((e) => `${e.a}>${e.b}`));
  const name = (id: string) => id;
  assert.equal(caption(0, steps, edges, shown, name), "Start with Page and Redirect.");
  assert.equal(caption(1, steps, edges, shown, name), "Page uses 6 screens and http. Redirect uses http.");
  assert.equal(caption(2, steps, [{ ...edge("http", "backend"), imports: 0, calls: 2 }], shown, name), "http calls backend.");
  // undrawn arrows are not mentioned; a step with none just names its boxes
  assert.equal(caption(2, steps, edges, new Set(), name), "Then backend.");
  // boxes doing the same thing share a sentence
  const two = [edge("Page", "http"), edge("Redirect", "http")];
  assert.equal(caption(1, steps, two, new Set(["Page>http", "Redirect>http"]), name), "Page and Redirect use http.");
});

test("reading: the viewer ships the walkthrough, and no separate reading or flows option", () => {
  const v = buildViewer();
  assert.match(v.css, /svg\.walking/);
  assert.match(v.css, /\.flow-pulse/);
  // one player for every tour, listed under "Tours" (#192)
  assert.match(v.js, /Leave the tour/);
  assert.doesNotMatch(v.js, /Walk through|data-walk/);
  assert.doesNotMatch(v.js, /repoladder\.read"|repoladder\.flows\.autoplay|read-btn/);
  assert.doesNotMatch(v.css, /svg\.reading|\.read-btn/);
});
