import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type StepsTour, type Tour } from "../src/model/schema.ts";
import { resolveTours } from "../src/model/tours.ts";
import type { Model } from "../src/model/rollup.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));

// Two levels: web and functions open into one box per file.
const grouping = (tours: Tour[]): Grouping => Grouping.parse({
  version: 1,
  summary: "A web app and its backend.",
  children: [
    { id: "web", name: "Web", summary: "", children: [
      { id: "web-api", name: "API client", summary: "", files: ["web/src/api.ts"] },
      { id: "web-main", name: "Main", summary: "", files: ["web/src/main.ts"] },
    ] },
    { id: "functions", name: "Functions", summary: "", children: [
      { id: "fn-index", name: "Index", summary: "", files: ["functions/src/index.ts"] },
      { id: "fn-server", name: "Server", summary: "", files: ["functions/src/server.ts"] },
    ] },
    { id: "other", name: "Other", summary: "", files: ["setup.mjs", "tools/**"] },
  ],
  tours,
});

const run = (tours: Tour[]) => {
  const g = grouping(tours);
  const a = assign(g, multi);
  assert.deepEqual(a.errors, []);
  const model = buildModel(multi, g, a.leafOf);
  return { model, ...resolveTours(g, model) };
};
const errorsOf = (steps: StepsTour["steps"]) => run([{ id: "t", title: "T", steps }]).errors.join("\n");

test("tours: each step is placed on the board that shows it, across levels", () => {
  const { tours, errors } = run([{ id: "ping", title: "Ping", steps: [
    { text: "The user opens the web app.", node: "web" },
    { text: "Web calls the backend.", edge: ["web", "functions"] },
    { text: "Inside web, the API client imports main.", edge: ["web-api", "web-main"] },
    { text: "The API client reaches the backend by name.", edge: ["web-api", "functions"] },
    { text: "The calls land in the index.", edge: ["web", "fn-index"] },
    { text: "The server handles users.", node: "fn-server" },
    { text: "Payments go to Stripe.", node: "svc-stripe" },
  ] }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(tours[0].steps.map((s) => s.board), ["root", "root", "web", "web", "functions", "functions", "root"]);
  assert.deepEqual(tours[0].steps[1], { text: "Web calls the backend.", board: "root", edge: ["web", "functions"] });
  assert.deepEqual(tours[0].steps[0], { text: "The user opens the web app.", board: "root", node: "web" });
});

test("tours: a step may name the dial stop it plays at; Default is left out of the model", () => {
  const { tours, errors } = run([{ id: "deep", title: "Deep", steps: [
    { text: "The whole system.", node: "web", stop: "everything" },
    { text: "Web calls the backend.", edge: ["web", "functions"], stop: "+1" },
    { text: "Back at Default.", node: "functions", stop: "default" },
    { text: "Unnamed is Default.", node: "functions" },
  ] }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(tours[0].steps.map((s) => s.stop), ["everything", "+1", undefined, undefined]);
  assert.ok(!("stop" in tours[0].steps[2]));
  const withStop = (stop: string) => ({ version: 1, summary: "", children: [{ id: "a", name: "A", summary: "", files: ["**"] }], tours: [{ id: "t", title: "T", steps: [{ text: "x", node: "a", stop }] }] });
  for (const stop of ["simple", "+1", "+12", "everything"]) assert.equal(Grouping.safeParse(withStop(stop)).success, true, stop);
  for (const stop of ["+0", "detailed", "Default", "+100"]) assert.equal(Grouping.safeParse(withStop(stop)).success, false, stop);
});

test("tours: a pinned board is honoured and checked", () => {
  const ok = run([{ id: "t", title: "T", steps: [{ text: "x", node: "web", board: "web" }] }]);
  assert.match(ok.errors.join("\n"), /"web" is not drawn on board "web"/);
  const pinned = run([{ id: "t", title: "T", steps: [{ text: "x", edge: ["web", "fn-server"], board: "functions" }] }]);
  assert.deepEqual(pinned.errors, []);
  assert.equal(pinned.tours[0].steps[0].board, "functions");
  assert.match(errorsOf([{ text: "x", node: "web", board: "nope" }]), /board "nope" is not a board/);
});

test("tours: steps must name real ids and real edges", () => {
  assert.match(errorsOf([{ text: "x", node: "ghost" }]), /unknown id "ghost"/);
  assert.match(errorsOf([{ text: "x", edge: ["web", "ghost"] }]), /unknown id "ghost"/);
  // invented: main never reaches the server
  assert.match(errorsOf([{ text: "x", edge: ["web-main", "fn-server"] }]), /no edge web-main -> fn-server on any board/);
  // reversed: the hint says which way it points
  assert.match(errorsOf([{ text: "x", edge: ["functions", "web"] }]), /there is one web -> functions/);
  const dup = run([{ id: "t", title: "A", steps: [{ text: "x", node: "web" }] }, { id: "t", title: "B", steps: [{ text: "x", node: "web" }] }]);
  assert.match(dup.errors.join("\n"), /duplicate tour id "t"/);
});

test("tours: the schema rejects malformed steps", () => {
  const bad = (steps: unknown) => Grouping.safeParse({ ...grouping([]), tours: [{ id: "t", title: "T", steps }] }).success;
  assert.equal(bad([{ text: "x", node: "web" }]), true);
  assert.equal(bad([{ text: "x", node: "web", edge: ["web", "functions"] }]), false);
  assert.equal(bad([{ text: "x" }]), false);
  assert.equal(bad([{ text: "x", edge: ["web"] }]), false);
  assert.equal(bad([]), false);
});

test("tours: carried into the page data, and absent when there are none", () => {
  const layout = {} as Parameters<typeof renderHtml>[1];
  const { model, tours } = run([{ id: "ping", title: "Ping", steps: [{ text: "Web calls the backend.", edge: ["web", "functions"] }] }]);
  assert.ok(!("tours" in pageData(renderHtml(model, layout))));
  model.tours = tours;
  assert.ok(JSON.stringify(pageData(renderHtml(model, layout))).includes('"tours":[{"id":"ping","title":"Ping"'));
});

test("tours: an edge step lands on the shallowest board that draws it as an arrow", () => {
  const edge = (major: boolean) => ({ a: "fn-pay", b: "svc-stripe", imports: 0, calls: 0, uses: 2, major, ev: [] });
  const node = (parent: string | null) => ({ name: "", summary: "", parent, children: [], files: [], count: 1, loc: 1 });
  // root draws it when both ends are boxes there; else only `functions` does
  const mk = (rootMajor: boolean, rootBoxes: string[], fnMajor: boolean) => ({
    nodes: { root: node(null), functions: node("root"), "fn-pay": node("functions") },
    services: { "svc-stripe": "Stripe" },
    boards: {
      root: { nodes: rootBoxes, edges: [edge(rootMajor)], throughout: [], hubs: [], context: [] },
      functions: { nodes: ["fn-pay", "svc-stripe"], edges: [edge(fnMajor)], throughout: [], hubs: [], context: [] },
    },
  }) as unknown as Model;
  const g = (board?: string) => grouping([{ id: "t", title: "T", steps: [{ text: "Pay.", edge: ["fn-pay", "svc-stripe"], ...(board ? { board } : {}) }] }]);
  const both = ["fn-pay", "svc-stripe"];
  // both draw it: the shallowest
  let r = resolveTours(g(), mk(true, both, true));
  assert.deepEqual([r.errors, r.warnings, r.tours[0].steps[0].board], [[], [], "root"]);
  // root only lists it (minor, Stripe "used throughout"): the deeper drawing board wins
  r = resolveTours(g(), mk(false, ["fn-pay"], true));
  assert.deepEqual([r.warnings, r.tours[0].steps[0].board], [[], "functions"]);
  // a deeper board that draws beats a shallower one that only lists, even with both ends as boxes
  assert.equal(resolveTours(g(), mk(false, both, true)).tours[0].steps[0].board, "functions");
  // nothing draws it: the shallowest board that lists it, and one warning (never an error)
  r = resolveTours(g(), mk(false, ["fn-pay"], false));
  assert.deepEqual([r.errors, r.tours[0].steps[0].board], [[], "root"]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /tours\[0\] "t" step 1: edge fn-pay -> svc-stripe is listed on board "root" but no board draws it as an arrow/);
  // a pinned board is never moved, and never warned about
  r = resolveTours(g("root"), mk(false, ["fn-pay"], true));
  assert.deepEqual([r.warnings, r.tours[0].steps[0].board], [[], "root"]);
});
