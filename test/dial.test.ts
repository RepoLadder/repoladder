import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnCut, landAt, landOn, landTurn, mapHit, mapStep, stepFrom } from "../src/viewer/dialmap.ts";
import type { StopBoard } from "../src/viewer/stops.ts";
import type { PageNode } from "../src/viewer/state.ts";

// root > viewer > {draw > {boxes, wires}, start, move}; boxes holds files 0 and 1, wires file 2
const node = (id: string, parent: string | null, children: string[], files: number[] = []): PageNode =>
  ({ id, parent, children, files, name: id, count: files.length || children.length } as unknown as PageNode);
const tree: Record<string, PageNode> = {
  root: node("root", null, ["viewer"]), viewer: node("viewer", "root", ["draw", "start", "move"]),
  draw: node("draw", "viewer", ["boxes", "wires"]), boxes: node("boxes", "draw", [], [0, 1]), wires: node("wires", "draw", [], [2]),
  start: node("start", "viewer", [], [3]), move: node("move", "viewer", [], [4]),
};
const paths = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
const edge = (a: string, b: string) => ({ a, b, imports: 1, calls: 0, uses: 0, major: true, ev: [] });
// Default's viewer board, and the viewer cut at a budget with `draw` opened into a container
const defaultViewer = { nodes: ["draw", "start", "move", "svc"], context: [], hubs: [], throughout: [], edges: [edge("start", "draw")] } as StopBoard;
const cutViewer = {
  nodes: ["draw", "boxes", "wires", "start", "move", "svc"], context: [], hubs: [], throughout: [],
  edges: [edge("boxes", "wires"), edge("start", "draw")],
  inside: { draw: "viewer", boxes: "draw", wires: "draw", start: "viewer", move: "viewer", svc: "viewer" },
} as StopBoard;

test("dial: a board as drawn reads as a cut: containers open, the rest closed", () => {
  const c = drawnCut("viewer", cutViewer);
  assert.deepEqual(Object.keys(c.open).sort(), ["draw", "viewer"]);
  assert.deepEqual(c.boxes, ["boxes", "wires", "start", "move", "svc"]);
  assert.deepEqual(Object.keys(drawnCut("viewer", defaultViewer).open), ["viewer"]);
});

test("dial: a selected box stays selected when the new board draws it", () => {
  assert.equal(mapHit("n:boxes", "viewer", cutViewer, tree, paths), "n:boxes");
  assert.equal(mapHit("n:svc", "viewer", cutViewer, tree, paths), "n:svc");
  assert.equal(mapHit("n:draw", "viewer", cutViewer, tree, paths), "n:draw", "a container is drawn too");
});

test("dial: a box no longer drawn selects the drawn box or container that holds it", () => {
  assert.equal(mapHit("n:wires", "viewer", defaultViewer, tree, paths), "n:draw");
  assert.equal(mapHit("n:@1", "viewer", cutViewer, tree, paths), "n:boxes", "a file: its leaf");
  assert.equal(mapHit("n:@1", "viewer", defaultViewer, tree, paths), "n:draw");
  assert.equal(mapHit("e:start>boxes", "viewer", defaultViewer, tree, paths), "e:start>draw");
});

test("dial: a selection with no place on the new board is cleared", () => {
  assert.equal(mapHit("n:viewer", "viewer", cutViewer, tree, paths), null, "the board itself");
  assert.equal(mapHit("n:elsewhere", "viewer", cutViewer, tree, paths), null);
  assert.equal(mapHit("e:move>start", "viewer", cutViewer, tree, paths), null, "no such arrow here");
  assert.equal(mapHit(null, "viewer", cutViewer, tree, paths), null);
});

// A large app:: four stops between Default and Everything; a small repo has none
const big = ["everything", "+4", "+3", "+2", "+1", "default", "simple"];
const small = ["everything", "default"];

test("dial: a remembered stop is relative to Default and lands on this repo's nearest", () => {
  assert.equal(landOn(null, big), "default");
  assert.equal(landOn("+2", big), "+2");
  assert.equal(landOn("+6", big), "+4", "past the range: the top middle stop");
  assert.equal(landOn("+6", ["everything", "+2", "+1", "default"]), "+2");
  assert.equal(landOn("+1", small), "default", "no middle stops");
  assert.equal(landOn("everything", small), "everything");
  assert.equal(landOn("simple", small), "default", "no Simple on this page");
  assert.equal(landOn("bogus", big), "default");
});

test("dial: the first version's `detailed` reads as +1", () => {
  assert.equal(landOn("detailed", big), "+1");
  assert.equal(landOn("detailed", small), "default");
});

test("dial: Alt+arrows step through this repo's stops and stop at the ends", () => {
  assert.equal(stepFrom(big, "default", -1), "+1");
  assert.equal(stepFrom(big, "+4", -1), "everything");
  assert.equal(stepFrom(big, "everything", -1), null);
  assert.equal(stepFrom(big, "default", 1), "simple");
  assert.equal(stepFrom(big, "simple", 1), null);
  assert.equal(stepFrom(small, "default", -1), "everything");
  assert.equal(stepFrom(small, "+2", -1), null, "a stop this repo lacks");
});

test("dial: a stop asked for on the story level opens on the root when the page has no story (#271)", () => {
  assert.equal(landAt("_story", false), "root");
  assert.equal(landAt("_story", true), "_story");
  assert.equal(landAt("web", false), "web");
  assert.equal(landAt(undefined, false), undefined);
});

// A turn that removes your board lands on its nearest surviving one and remembers where you were (#327)
const at = (board: string, stop: string, hit: string | null = null) => ({ board, hit, view: [1, 2, 3, 4], stop });
// Default has every board; "more" keeps only root; "mid" keeps root and viewer
const exists: Record<string, string[]> = { default: ["root", "viewer", "draw"], mid: ["root", "viewer"], more: ["root"] };
const nearest = (stop: string) => (id: string) => { for (let c: string | null = id; c; c = tree[c]?.parent ?? null) if (exists[stop].includes(c)) return c; return "root"; };
const same = nearest("default");

test("dial: a turn that keeps your board starts no jump", () => {
  const r = landTurn(at("viewer", "default"), null, nearest("mid"), same);
  assert.deepEqual(r, { board: "viewer", restore: false, jump: null });
});

test("dial: a turn that removes your board lands on its nearest layer and remembers the board", () => {
  const cur = at("draw", "default", "n:boxes");
  const r = landTurn(cur, null, nearest("mid"), same);
  assert.equal(r.board, "viewer");
  assert.deepEqual(r.jump, cur);
  const top = landTurn(at("viewer", "mid"), r.jump, nearest("more"), same);
  assert.equal(top.board, "root");
  assert.deepEqual(top.jump, cur, "the memory survives successive turns");
  assert.equal(top.restore, false);
});

test("dial: turning back down returns to the remembered board and spends the memory", () => {
  const cur = at("draw", "default", "n:boxes");
  const down = landTurn(at("root", "more"), cur, nearest("mid"), same);
  assert.equal(down.board, "viewer", "the deepest ancestor of the pre-jump board that exists");
  assert.equal(down.restore, false);
  const home = landTurn(at("viewer", "mid"), cur, nearest("default"), same);
  assert.deepEqual(home, { board: "draw", restore: true, jump: null });
});

test("mapStep: a step's boxes and arrows become the boxes that hold them on the board played on (#327)", () => {
  const step = { board: "draw", lit: { boxes: ["boxes", "wires"], edges: [["boxes", "wires"], ["start", "boxes"]] as [string, string][] } };
  const m = mapStep(step, "viewer", defaultViewer, tree, paths);
  assert.equal(m.board, "viewer");
  assert.deepEqual(m.lit.boxes.sort(), ["draw", "start"]);
  assert.deepEqual(m.lit.edges, [["start", "draw"]], "an arrow inside one box is dropped; the other joins its holders");
});
