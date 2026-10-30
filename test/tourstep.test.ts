import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageEdge } from "../src/viewer/state.ts";
import { arrowsOf, begin, flowTour, fromModel, litMarks, readTour, shownArrows, stepBy, type PlayTour } from "../src/viewer/tourstep.ts";

const edge = (a: string, b: string, o: Partial<PageEdge> = {}): PageEdge => ({ a, b, imports: 1, calls: 0, uses: 0, major: true, ev: [], ...o });
const name = (id: string) => id;

test("tour steps: a board's flow is a single-board tour, one hop a step, at Default unless started elsewhere", () => {
  const t = flowTour("web", 1, { title: "Check-in", path: ["Kiosk", "http", "backend"] }, [edge("http", "backend", { imports: 0, calls: 2 })], name);
  assert.deepEqual([t.id, t.source], ["@1", "flow"]);
  assert.deepEqual(t.steps, [
    { board: "web", stop: "default", lit: { boxes: ["Kiosk", "http"], edges: [["Kiosk", "http"]] }, caption: "Kiosk uses http." },
    { board: "web", stop: "default", lit: { boxes: ["http", "backend"], edges: [["http", "backend"]] }, caption: "http calls backend." },
  ]);
  assert.equal(flowTour("web", 0, { title: "x", path: ["a", "b"] }, [], name, "+1").steps[0].stop, "+1");
});

test("tour steps: the grouping's tours are multi-board, an edge step lighting its arrow and both ends", () => {
  const t = fromModel({ id: "ping", title: "Ping", steps: [
    { text: "Open the app.", board: "root", node: "web" },
    { text: "It calls the backend.", board: "web", edge: ["api", "fn"] },
  ] });
  assert.deepEqual([t.id, t.source], ["ping", "claude"]);
  assert.deepEqual(t.steps[0], { board: "root", stop: "default", lit: { boxes: ["web"], edges: [] }, caption: "Open the app." });
  assert.deepEqual(t.steps[1], { board: "web", stop: "default", lit: { boxes: ["api", "fn"], edges: [["api", "fn"]] }, caption: "It calls the backend." });
  // a step that names a stop plays there (#195)
  const d = fromModel({ id: "d", title: "D", steps: [{ text: "x", board: "root", node: "web", stop: "+2" }, { text: "y", board: "web", node: "api" }] });
  assert.deepEqual(d.steps.map((s) => s.stop), ["+2", "default"]);
  // a composed step (chain or derived tour) lights its own boxes and arrows, drawn at its stop
  const lit = { boxes: ["@3", "@4"], edges: [["@3", "@4"]] as [string, string][] };
  const c = fromModel({ id: "c", title: "C", source: "derived", steps: [{ text: "z", board: "web", edge: ["@3", "@4"], stop: "+1", lit, via: ["a.ts", "b.ts"] }] });
  assert.equal(c.source, "derived");
  assert.deepEqual(c.steps[0], { board: "web", stop: "+1", caption: "z", lit, via: ["a.ts", "b.ts"] });
});

test("tour steps: a board without flows is read layer by layer, with its parts' summaries", () => {
  const layers = [["Page"], ["http"], ["backend"]];
  const t = readTour("b", layers, [edge("Page", "http"), edge("http", "backend")], new Set(["Page>http", "http>backend"]), name, (id) => (id === "http" ? [id, "Talks to the server."] : undefined));
  assert.equal(t.id, "@read");
  assert.deepEqual(t.steps.map((s) => [s.lit.boxes.sort(), arrowsOf(s)]), [[["Page"], []], [["Page", "http"], ["Page>http"]], [["backend", "http"], ["http>backend"]]]);
  assert.deepEqual(t.steps[1].notes, [["http", "Talks to the server."]]);
  assert.equal(t.steps[0].caption, "Start with Page.");
});

test("tour steps: a step lights its boxes and arrows; everything else dims, never hidden", () => {
  const m = litMarks({ board: "b", stop: "default", lit: { boxes: ["a", "b"], edges: [["a", "b"]] }, caption: "" }, ["n:a", "n:b", "n:c", "e:a>b", "e:c>a"]);
  assert.deepEqual([...m], [["n:a", "now"], ["n:b", "now"], ["n:c", "off"], ["e:a>b", "now"], ["e:c>a", "off"]]);
});

test("tour steps (#394): only the step's own forward arrow lights; a reverse-only board lights none", () => {
  const s = { board: "b", stop: "default", lit: { boxes: ["a", "b"], edges: [["a", "b"]] as [string, string][] }, caption: "" };
  assert.deepEqual(shownArrows(s, ["n:a", "n:b", "e:a>b", "e:b>a"]), [{ key: "a>b" }], "both drawn: never the reverse");
  assert.deepEqual(shownArrows(s, ["n:a", "n:b", "e:b>a"]), [], "reverse only: no arrow lit");
  assert.deepEqual(shownArrows(s, ["n:a", "n:b", "e:a>c"]), [], "drawn neither way: no arrow lit");
  const m = litMarks(s, ["n:a", "n:b", "e:b>a", "e:c>a"]);
  assert.deepEqual([m.get("e:b>a"), m.get("e:c>a")], ["off", "off"]);
});

const tour = (id: string, n: number): PlayTour => ({ id, title: id, source: "flow", steps: Array.from({ length: n }, (_, i) => ({ board: "root", stop: "default", lit: { boxes: [`x${i}`], edges: [] }, caption: "" })) });

test("tour player: only one tour plays; starting another ends it, and its own row again leaves", () => {
  const flow = tour("@0", 3), group = tour("ping", 5);
  let now = begin(null, flow);
  now = stepBy(now, 1);
  assert.deepEqual([now?.tour.id, now?.i], ["@0", 1]);
  now = begin(now, group, 2);
  assert.deepEqual([now?.tour.id, now?.i], ["ping", 2], "the flow ended, the tour plays");
  assert.equal(begin(now, group, 0, true), null, "picking the playing tour's row leaves it");
  assert.equal(begin(now, flow, 0, true)?.tour.id, "@0", "another tour's row switches to it");
  assert.equal(begin(null, group, 99)?.i, 4, "the step is clamped");
  assert.equal(begin(null, tour("empty", 0)), null);
});

test("tour player: Next past the last step is Done; keys stop at both ends", () => {
  const t = { tour: tour("@0", 2), i: 1 };
  assert.equal(stepBy(t, 1), null);
  assert.equal(stepBy(t, 1, true)?.i, 1);
  assert.equal(stepBy({ ...t, i: 0 }, -1)?.i, 0);
  assert.equal(stepBy(null, 1), null);
});
