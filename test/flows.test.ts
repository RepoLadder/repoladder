import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel, type Board, type ModelEdge } from "../src/model/rollup.ts";
import { Grouping, type FlowSpec } from "../src/model/schema.ts";
import { deriveFlows, modelRoles, resolveFlows, MAX_FLOWS, type FlowRoles } from "../src/model/flows.ts";
import type { Facts } from "../src/model/schema.ts";
import type { Model } from "../src/model/rollup.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));

const grouping = (flows?: FlowSpec[]): Grouping => Grouping.parse({
  version: 1,
  summary: "A web app and its backend.",
  children: [
    { id: "web", name: "Web", summary: "", children: [
      { id: "web-api", name: "API client", summary: "", files: ["web/src/api.ts"] },
      { id: "web-main", name: "Main", summary: "", files: ["web/src/main.ts"] },
    ] },
    { id: "functions", name: "Functions", summary: "", files: ["functions/src/**"] },
    { id: "other", name: "Other", summary: "", files: ["setup.mjs", "tools/**"] },
  ],
  ...(flows ? { flows } : {}),
});

const run = (flows?: FlowSpec[]) => {
  const g = grouping(flows);
  const a = assign(g, multi);
  assert.deepEqual(a.errors, []);
  const model = buildModel(multi, g, a.leafOf);
  return { model, ...resolveFlows(g, model, multi) };
};

// a synthetic board: ids are their own names; "svc-x" and "ctx" are sinks
const E = (a: string, b: string, calls = 0, major = true): ModelEdge => ({ a, b, imports: calls ? 0 : 1, calls, uses: 0, major, ev: [] });
const board = (edges: ModelEdge[], extra: string[] = []): Board => ({
  nodes: [...new Set([...edges.flatMap((e) => [e.a, e.b]), ...extra])].sort(), edges, throughout: [], hubs: [], context: ["ctx"],
});
const roles = (entries: string[] = []): FlowRoles => ({ entry: (id) => entries.includes(id), sink: (id) => id === "ctx" || id.startsWith("svc-"), name: (id) => id.toUpperCase() });
const paths = (fs: { path: string[] }[]) => fs.map((f) => f.path.join(" "));

test("flows: the longest chain from an entry to a sink comes first, preferring calls", () => {
  const b = board([E("page", "a"), E("a", "b"), E("b", "svc-x"), E("page", "c", 2), E("c", "svc-x"), E("a", "dead")]);
  const fs = deriveFlows(b, roles());
  assert.deepEqual(paths(fs), ["page c svc-x", "page a b svc-x", "page a dead"]);
  assert.equal(fs[0].title, "PAGE → SVC-X via C");
  assert.equal(fs[1].title, "PAGE → SVC-X via A");
  assert.equal(fs[2].title, "PAGE → DEAD");
});

test("flows: a chain whose arrows other flows mostly show is skipped, and at most MAX_FLOWS are kept", () => {
  // a fan: page -> hub -> each of 8 leaves; every chain shares page -> hub
  const leaves = Array.from({ length: 8 }, (_, i) => `l${i}`);
  const b = board([E("page", "hub"), ...leaves.map((l) => E("hub", l))]);
  const fs = deriveFlows(b, roles());
  // after the first, each chain has 1 new arrow of 2: still half new, so allowed
  assert.equal(fs.length, MAX_FLOWS);
  const b2 = board([E("p", "a"), E("a", "b"), E("b", "c"), E("c", "x"), E("c", "y")]);
  assert.deepEqual(paths(deriveFlows(b2, roles())), ["p a b c x"]);
});

test("flows: entries are boxes nothing points into, or pages; minor edges and +more are never followed", () => {
  const b = board([E("top", "page"), E("page", "a"), E("a", "svc-x"), E("x", "y", 0, false), E("+more", "svc-x")]);
  assert.deepEqual(paths(deriveFlows(b, roles(["page"]))), ["top page a svc-x"]);
  // in a loop nothing is a start unless it is an entry
  const loop = board([E("page", "a"), E("a", "page"), E("a", "svc-x")]);
  assert.deepEqual(paths(deriveFlows(loop, roles())), []);
  assert.deepEqual(paths(deriveFlows(loop, roles(["page"]))), ["page a svc-x"]);
});

test("flows: single arrows fill a board only when it has few longer chains", () => {
  const b = board([E("p", "q"), E("r", "svc-x"), E("s", "ctx")]);
  assert.deepEqual(paths(deriveFlows(b, roles())), ["r svc-x", "s ctx", "p q"]);
  const many = board([E("a", "b"), E("b", "svc-x"), E("c", "d"), E("d", "ctx"), E("e", "f"), E("f", "g"), E("z", "svc-x")]);
  assert.deepEqual(paths(deriveFlows(many, roles())), ["a b svc-x", "c d ctx", "e f g"]);
});

test("flows: every derived flow follows drawn edges on its own board, deterministically", () => {
  const one = run(), two = run();
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.flows, two.flows);
  assert.ok(Object.keys(one.flows).length > 0);
  for (const [id, fs] of Object.entries(one.flows)) {
    const b = one.model.boards[id];
    assert.ok(fs.length <= MAX_FLOWS);
    for (const f of fs) for (let i = 1; i < f.path.length; i++) {
      assert.ok(b.edges.some((e) => e.major && e.a === f.path[i - 1] && e.b === f.path[i]), `${id}: ${f.path.join(" → ")}`);
    }
  }
});

test("flows: named flows come first with their captions; the derived ones fill in", () => {
  const { flows } = run();
  const first = flows.root[0];
  const named = run([{ board: "root", title: "Sign-in", path: first.path, captions: first.path.slice(1).map((_, i) => `step ${i + 1}`) }]);
  assert.deepEqual(named.errors, []);
  assert.deepEqual(named.flows.root[0], { title: "Sign-in", path: first.path, captions: first.path.slice(1).map((_, i) => `step ${i + 1}`), named: true });
  assert.ok(named.flows.root.slice(1).every((f) => f.path.join() !== first.path.join()));
});

test("flows: named flows are validated like tours", () => {
  const err = (f: Partial<FlowSpec>) => run([{ board: "root", title: "T", path: ["web", "functions"], ...f } as FlowSpec]).errors.join("\n");
  assert.equal(err({}), "");
  assert.match(err({ board: "nope" }), /board "nope" is not a board/);
  assert.match(err({ path: ["web", "ghost"] }), /"ghost" is not drawn on board "root"/);
  assert.match(err({ path: ["functions", "web"] }), /no edge functions -> web on board "root" \(there is one the other way round/);
  assert.match(err({ captions: ["a", "b"] }), /2 captions for 1 steps/);
  // on a file board, file boxes are named by their path
  const path = ["web", "functions/src/index.ts", "functions/src/server.ts"];
  assert.equal(err({ board: "functions", path }), "");
  // an edge the board only lists can't be played
  const g = grouping([{ board: "functions", title: "T", path }]);
  const { model } = run();
  model.boards.functions.edges.find((e) => e.a === "f:functions/src/index.ts")!.major = false;
  assert.match(resolveFlows(g, model, multi).errors.join("\n"), /step 2: the edge functions\/src\/index.ts -> functions\/src\/server.ts is not drawn on board "functions" \(only listed\)/);
});

test("flows: titles are distinct; a flow between the same two boxes as another, through nothing new, is dropped", () => {
  // s1 and s2 are both named "S", as two files with the same stem would be
  const named: FlowRoles = { entry: () => false, sink: (id) => id.startsWith("svc-"), name: (id) => id.replace(/\d$/, "").toUpperCase() };
  const fs = deriveFlows(board([E("s1", "svc-x"), E("s2", "svc-x"), E("s1", "a"), E("a", "svc-x"), E("s2", "b"), E("b", "svc-x")]), named);
  const titles = fs.map((f) => f.title);
  assert.equal(new Set(titles).size, titles.length);
  assert.deepEqual(titles, ["S → SVC-X via A", "S → SVC-X via B"]);
});

test("flows: a file box is named by its page's route or its endpoint, not by a stem like page or route", () => {
  const facts = {
    pages: [{ route: "/login", file: "app/login/page.tsx", from: "app/login/page.tsx", line: 1 }],
    routeFiles: [{ route: "/", file: "app/layout.tsx", role: "layout" }, { route: "/a, /b", file: "middleware.ts", role: "middleware" }],
    endpoints: [{ name: "/api/posts", file: "app/api/posts/route.ts", line: 1, kind: "http" }, { name: "/api/posts", file: "app/api/posts/route.ts", line: 9, kind: "http" }],
  } as unknown as Facts;
  const model = { boards: { b: { context: [] } }, services: {}, nodes: {} } as unknown as Model;
  const { name } = modelRoles(model, facts, "b");
  const files = ["app/login/page.tsx", "app/layout.tsx", "middleware.ts", "app/api/posts/route.ts", "lib/db.ts"];
  assert.deepEqual(files.map((f) => name(`f:${f}`)), ["/login page", "root layout", "middleware", "/api/posts", "db"]);
});

test("flows: the page always carries them for the walkthrough, with file boxes as @index", () => {
  const { model, flows } = run();
  const layout = Object.fromEntries(Object.keys(model.boards).map((id) => [id, { n: [], e: [] }]));
  assert.ok(!("flows" in pageData(renderHtml(model, layout))), "a model without flows adds nothing");
  model.flows = flows;
  const data = pageData(renderHtml(model, layout));
  assert.deepEqual(Object.keys(data.flows).sort(), Object.keys(flows).sort());
  for (const fs of Object.values(data.flows) as { path: string[]; named?: true }[][]) {
    for (const f of fs) { assert.ok(!("named" in f)); assert.ok(f.path.every((id) => !id.startsWith("f:"))); }
  }
});
