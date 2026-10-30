import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageEdge } from "../src/viewer/state.ts";
import { hopCaption, hops, walkAction, waves } from "../src/viewer/walkorder.ts";

const edge = (a: string, b: string, o: Partial<PageEdge> = {}): PageEdge => ({ a, b, imports: 1, calls: 0, uses: 0, major: true, ev: [], ...o });
const path = ["Kiosk", "http", "backend", "Firestore"];
const hits = ["n:Kiosk", "n:http", "n:backend", "n:Firestore", "n:Other", "e:Kiosk>http", "e:http>backend", "e:backend>Firestore", "e:Other>http"];

test("walk: a flow is stepped one hop at a time, in path order", () => {
  assert.deepEqual(hops(path), ["Kiosk>http", "http>backend", "backend>Firestore"]);
});

test("walk: a hop's caption is the grouping's, or what the drawn arrow does", () => {
  const name = (id: string) => id;
  assert.equal(hopCaption("Kiosk", "http", edge("Kiosk", "http"), name), "Kiosk uses http.");
  assert.equal(hopCaption("http", "backend", edge("http", "backend", { imports: 0, calls: 3 }), name), "http calls backend.");
  assert.equal(hopCaption("backend", "Firestore", edge("backend", "Firestore", { reads: 2, writes: 1 }), name), "backend reads and writes Firestore.");
  assert.equal(hopCaption("Kiosk", "http", edge("Kiosk", "http"), name, "The kiosk posts the check-in."), "The kiosk posts the check-in.");
});

test("walk: Escape and a click on empty canvas leave; a pan does not; arrows step", () => {
  assert.equal(walkAction({ key: "Escape" }), "leave");
  assert.equal(walkAction({ key: "ArrowRight" }), "next");
  assert.equal(walkAction({ key: "ArrowLeft" }), "prev");
  assert.equal(walkAction({ key: "a" }), null);
  const click = { picked: false, canvas: true, box: false, dragged: false };
  assert.equal(walkAction(click), "leave", "empty canvas");
  assert.equal(walkAction({ ...click, dragged: true }), null, "the release of a pan");
  assert.equal(walkAction({ ...click, box: true, picked: true }), "leave", "picking a box leaves for its details");
  assert.equal(walkAction({ ...click, canvas: false }), null, "a click in the side panel keeps walking");
});

test("walk: a story sentence's arrows pulse in waves from where they start", () => {
  assert.deepEqual(waves(["web>functions", "patient>web", "functions>firestore", "functions>stripe"]), [["patient>web"], ["web>functions"], ["functions>firestore", "functions>stripe"]]);
  // two actors start at once; an arrow a cycle keeps out goes last
  assert.deepEqual(waves(["a>x", "b>x", "x>y", "y>x"]), [["a>x", "b>x"], ["x>y"], ["y>x"]]);
  assert.deepEqual(waves(["p>q", "q>p"]), [["p>q", "q>p"]]);
  assert.deepEqual(waves([]), []);
});
