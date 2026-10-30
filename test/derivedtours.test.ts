import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { resolveFlows } from "../src/model/flows.ts";
import { deriveTours, MAX_DERIVED } from "../src/model/derivedtours.ts";
import { tourGraph } from "../src/model/chaintours.ts";
import type { ModelTour } from "../src/model/tours.ts";
import { Grouping } from "../src/model/schema.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import type { ViewerData } from "../src/viewer/state.ts";

// three pages, each calling its own endpoint in one functions/index.ts, ending in Firestore or Stripe
const facts = analyze(fileURLToPath(new URL("./fixtures/tourapp", import.meta.url)));
const model = () => {
  const g = defaultGrouping(facts), a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  const m = buildModel(facts, g, a.leafOf);
  const f = resolveFlows(g, m, facts);
  m.flows = f.flows;
  return m;
};

const chainOf = (t: { steps: { via?: [string, string] }[] }) => [...t.steps.map((s) => s.via![0]), t.steps.at(-1)!.via![1]];

test("derived tours run from each page to its sink, across parts", () => {
  const m = model(), tours = deriveTours(m, facts);
  assert.ok(tours.length >= 2 && tours.length <= MAX_DERIVED);
  assert.deepEqual(tours.map((t) => t.title), ["From the /admin page to Firestore", "From the /billing page to Stripe", "From the /kiosk page to Firestore"]);
  for (const t of tours) {
    assert.equal(t.source, "derived");
    assert.match(t.id, /^derived-/);
    // up to the root for the call, down again on the backend side
    assert.ok(t.steps.some((s) => s.board === "root"));
    assert.ok(t.steps.some((s) => s.board !== "root"));
    // every lit arrow is an edge of its board (all at Default here)
    for (const s of t.steps) {
      assert.equal(s.stop, "default");
      for (const [a, b] of s.lit.edges) assert.ok(m.boards[s.board].edges.some((e) => e.a === a && e.b === b), `${s.board}: ${a} -> ${b}`);
    }
  }
  const kiosk = tours.find((t) => t.title.includes("/kiosk"))!;
  // the checkIn endpoint goes on to checkin.ts, not to a sibling endpoint's charge.ts
  assert.deepEqual(chainOf(kiosk), ["web/src/kiosk/KioskPage.tsx", "web/src/kiosk/kioskHttp.ts", "functions/src/index.ts", "functions/src/checkin.ts", "functions/src/forms.ts", "store-firestore"]);
  assert.deepEqual(kiosk.steps.map((s) => s.caption), [
    "KioskPage uses kioskHttp",
    "kioskHttp calls checkIn in index (Web → Functions)",
    "index uses checkin",
    "checkin uses forms",
    "forms writes Forms in Firestore",
  ]);
  const billing = tours.find((t) => t.title.includes("/billing"))!;
  assert.deepEqual(billing.steps.at(-1)!.lit.edges, [["f:functions/src/charge.ts", "svc-stripe"]]);
});

test("derived tours are deterministic", () => {
  assert.deepEqual(deriveTours(model(), facts), deriveTours(model(), facts));
});

test("a derived tour that retells a grouping tour is skipped", () => {
  const m = model(), all = deriveTours(m, facts);
  const kiosk = all.find((t) => t.title.includes("/kiosk"))!;
  const taken: ModelTour[] = [{ id: "check-in", title: "Check-in", steps: kiosk.steps.map((s) => ({ text: s.caption, board: s.board, edge: s.lit.edges[0] })) }];
  const left = deriveTours(m, facts, taken);
  assert.ok(!left.some((t) => t.title.includes("/kiosk")));
  assert.ok(left.length >= 2);
});

test("the graph for composeTour uses page ids, and the page carries derived tours with them", () => {
  const m = model();
  const g = tourGraph(m);
  assert.ok(Object.values(g.boards).every((b) => b.nodes.every((id) => !id.startsWith("f:"))));
  m.derivedTours = deriveTours(m, facts);
  const data = pageData(renderHtml(m, {})) as ViewerData;
  const t = data.derivedTours!.find((x) => x.title.includes("/kiosk"))!;
  const [a, b] = t.steps[0].lit.edges[0];
  assert.deepEqual([data.paths[Number(a.slice(1))], data.paths[Number(b.slice(1))]], ["web/src/kiosk/KioskPage.tsx", "web/src/kiosk/kioskHttp.ts"]);
});

test("derived tour titles are distinct: a tour from the same place to the same end as one picked is dropped", () => {
  const m = model();
  // two pages under one route read as one place
  const same = { ...facts, pages: facts.pages.map((p) => (p.route === "/admin" ? { ...p, route: "/kiosk" } : p)) };
  const titles = deriveTours(m, same).map((t) => t.title);
  assert.equal(titles.filter((t) => t === "From the /kiosk page to Firestore").length, 1);
  assert.equal(new Set(titles).size, titles.length);
});

test("without a route or endpoint, a derived tour is named by the box that holds its entry, not the file", () => {
  const g = Grouping.parse({
    version: 1, summary: "",
    children: [
      { id: "shell", name: "App shell", summary: "", files: ["web/src/App.tsx", "web/src/firebase.ts", "web/src/ui/**"] },
      { id: "screens", name: "Screens", summary: "", files: ["web/src/**"] },
      { id: "backend", name: "Cloud backend", summary: "", files: ["functions/src/**"] },
    ],
  });
  const a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  const m = buildModel(facts, g, a.leafOf);
  const titles = deriveTours(m, { ...facts, pages: [], endpoints: [] }).map((t) => t.title);
  assert.ok(titles.length > 0);
  for (const t of titles) assert.match(t, /^From App shell to /);
});

test("the grouping's own tours leave room for fewer derived ones", () => {
  const m = model(), all = deriveTours(m, facts);
  const tour = (id: string): ModelTour => ({ id, title: id, steps: [] });
  assert.equal(deriveTours(m, facts, [tour("a"), tour("b")]).length, Math.min(all.length, MAX_DERIVED - 2));
  assert.deepEqual(deriveTours(m, facts, ["a", "b", "c", "d"].map(tour)), []);
});

test("without an fgraph there is nothing to derive", () => {
  const m = model();
  delete m.fgraph;
  assert.deepEqual(deriveTours(m, facts), []);
});

// a library shaped like zustand: type-only middleware roots, a barrel, an example app
const libFacts = analyze(fileURLToPath(new URL("./fixtures/library", import.meta.url)));
const libModel = () => {
  const g = defaultGrouping(libFacts), a = assign(g, libFacts);
  assert.deepEqual(a.errors, []);
  const m = buildModel(libFacts, g, a.leafOf);
  m.flows = resolveFlows(g, m, libFacts).flows;
  return m;
};

test("a library with no tour from its roots falls back to its public modules and example app", () => {
  const m = libModel(), tours = deriveTours(m, libFacts);
  assert.ok(tours.length >= 2);
  assert.ok(tours.every((t) => t.source === "derived"));
  assert.equal(new Set(tours.map((t) => t.title)).size, tours.length);
  const chains = tours.map(chainOf);
  assert.ok(chains.some((c) => c[0] === "src/react.ts" && c.at(-1) === "src/vanilla.ts"));
  assert.ok(chains.some((c) => c[0] === "examples/demo/src/main.tsx" && c.includes("src/react.ts")));
  assert.deepEqual(deriveTours(m, libFacts), tours);
  // type-only imports run nothing: no step starts from a middleware file
  for (const t of tours) for (const s of t.steps) assert.ok(!s.lit.edges.some(([a]) => a.includes("src/middleware/")));
});

test("the library fallback needs a library package for its own modules", () => {
  const tours = deriveTours(libModel(), { ...libFacts, packages: [] });
  assert.ok(tours.length >= 1);
  for (const t of tours) assert.equal(chainOf(t)[0], "examples/demo/src/main.tsx");
});
