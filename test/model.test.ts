import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { compileGlob } from "../src/model/glob.ts";
import { assign, defaultGrouping, prefixOf } from "../src/model/grouping.ts";
import { buildModel, markMajor, type ModelEdge } from "../src/model/rollup.ts";
import type { Grouping } from "../src/model/schema.ts";

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));

test("globs", () => {
  const m = (p: string, f: string) => compileGlob(p).re.test(f);
  assert.ok(m("web/src/**", "web/src/a/b.ts"));
  assert.ok(m("web/src", "web/src/a/b.ts"));
  assert.ok(m("web/src/*.ts", "web/src/a.ts"));
  assert.ok(!m("web/src/*.ts", "web/src/a/b.ts"));
  assert.ok(m("**/billing*.ts", "functions/src/billingHelpers.ts"));
  assert.ok(!m("web/src", "web/srcx/a.ts"));
  assert.ok(compileGlob("web/src/billing/**").specificity > compileGlob("web/src/**").specificity);
});

test("each part gets the kind with the most lines; endpoint files count as backend", () => {
  const g = defaultGrouping(multi);
  const m = buildModel(multi, g, assign(g, multi).leafOf);
  assert.equal(m.nodes.root.kind, undefined);
  assert.equal(m.nodes.web.kind, "web");
  assert.equal(m.nodes.functions.kind, "backend");
  assert.equal(m.nodes.tools.kind, "scripts");
  assert.equal(m.nodes["multi-root"].kind, "library");
  // A web-package file that defines an endpoint is server code, and here it outweighs the rest.
  const facts = structuredClone(multi);
  const big = facts.files.find((f) => f.path === "web/src/api.ts")!;
  big.loc = 1000;
  facts.endpoints.push({ name: "api", file: big.path, line: 1, kind: "http" });
  assert.equal(buildModel(facts, g, assign(g, facts).leafOf).nodes.web.kind, "backend");
});

test("a React Router page's own action doesn't make its file backend (#295)", () => {
  const g = defaultGrouping(multi);
  const facts = structuredClone(multi);
  const big = facts.files.find((f) => f.path === "web/src/api.ts")!;
  big.loc = 1000;
  facts.pages.push({ route: "/api", file: big.path, from: big.path, line: 1 });
  facts.endpoints.push({ name: "/api", file: big.path, line: 1, kind: "http", methods: ["POST"] });
  assert.equal(buildModel(facts, g, assign(g, facts).leafOf).nodes.web.kind, "web");
});

test("filename prefixes", () => {
  assert.equal(prefixOf("warRoomErrors.ts"), "warRoom");
  assert.equal(prefixOf("billing.ts"), "billing");
  assert.equal(prefixOf("useCheckInFeed.ts"), "check");
  assert.equal(prefixOf("kiosk-shared.ts"), "kiosk");
});

test("default grouping covers every file exactly once", () => {
  const g = defaultGrouping(multi);
  assert.deepEqual(g.children.map((c) => c.id), ["web", "functions", "multi-root", "tools"]);
  const a = assign(g, multi);
  assert.deepEqual(a.errors, []);
  assert.equal(a.leafOf.size, multi.files.length);
});

test("validation reports uncovered and ambiguous files; most specific pattern wins", () => {
  const g: Grouping = {
    version: 1,
    summary: "",
    children: [
      { id: "app", name: "App", summary: "", files: ["web/**", "functions/src/*.ts"] },
      { id: "server", name: "Server", summary: "", files: ["functions/src/server.ts", "nope/**"] },
      { id: "dup", name: "Dup", summary: "", files: ["functions/src/*.ts"] },
    ],
  };
  const a = assign(g, multi);
  assert.equal(a.leafOf.get("functions/src/server.ts"), "server");
  assert.match(a.errors.join("\n"), /2 file\(s\) not covered[\s\S]*setup\.mjs[\s\S]*tools\/seed\.cjs/);
  assert.match(a.errors.join("\n"), /functions\/src\/index\.ts \(app, dup\)/);
  assert.deepEqual(a.warnings, ['pattern "nope/**" in "server" matches no files']);
});

test("rollup: edges between visible boxes, with evidence", () => {
  const g = defaultGrouping(multi);
  const m = buildModel(multi, g, assign(g, multi).leafOf);
  const root = m.boards.root;
  const e = (a: string, b: string) => root.edges.find((x) => x.a === a && x.b === b);
  assert.deepEqual(root.nodes, ["web", "functions", "multi-root", "tools", "svc-firebase-auth", "svc-stripe"]);
  assert.equal(e("web", "functions")?.calls, 3);
  assert.equal(e("web", "functions")?.imports, 0);
  assert.equal(e("web", "functions")?.major, true);
  assert.deepEqual(e("web", "functions")?.ev[0], ["web/src/api.ts", 4, "ping (functions/src/index.ts)"]);
  assert.equal(e("functions", "svc-stripe")?.uses, 1);
  assert.equal(m.nodes.root.count, multi.files.length);
});

test("rollup: context boxes show where a part's connections lead", () => {
  const g: Grouping = {
    version: 1,
    summary: "",
    children: [
      { id: "client", name: "Client", summary: "", children: [
        { id: "client-api", name: "API calls", summary: "", files: ["web/src/api.ts"] },
        { id: "client-core", name: "Core", summary: "", files: ["web/**"] },
      ] },
      { id: "server", name: "Server", summary: "", files: ["functions/**"] },
      { id: "rest", name: "Rest", summary: "", files: ["**"] },
    ],
  };
  const m = buildModel(multi, g, assign(g, multi).leafOf);
  const b = m.boards.client;
  assert.deepEqual(b.context, ["server"]);
  const e = b.edges.find((x) => x.a === "client-api" && x.b === "server");
  assert.equal(e?.calls, 3);
  assert.equal(e?.major, true);
  assert.equal(JSON.stringify(buildModel(multi, g, assign(g, multi).leafOf)), JSON.stringify(m));
});

const edge = (a: string, b: string, imports: number, calls = 0): ModelEdge => ({ a, b, imports, calls, uses: 0, major: false, ev: [] });

test("hubs: arrows into a hub are drawn when hiding them would leave the board bare", () => {
  // every app imports the shared packages and nothing else: hiding them would draw nothing
  const kids = ["expo", "next", "tanstack", "turbo", "shared"];
  const es = [edge("expo", "shared", 2), edge("next", "shared", 17), edge("tanstack", "shared", 15)];
  assert.deepEqual(markMajor(es, kids), []);
  assert.ok(es.every((e) => e.major && e.hub));
});

test("hubs: arrows into a hub stay hidden on a busy board with other structure", () => {
  const kids = ["a", "b", "c", "d", "e", "ui"];
  const es = [
    edge("a", "b", 5), edge("b", "c", 4), edge("c", "d", 3), edge("d", "e", 6),
    ...["a", "b", "c", "d", "e"].map((k) => edge(k, "ui", 20)),
  ];
  assert.deepEqual(markMajor(es, kids), ["ui"]);
  assert.ok(es.filter((e) => e.b === "ui").every((e) => e.hub && !e.major));
  assert.equal(es.filter((e) => e.major).length, 4);
});

test("hubs: a small board always draws its hub arrows", () => {
  const kids = ["a", "b", "c", "ui"];
  const es = [edge("a", "b", 5), edge("b", "c", 4), ...["a", "b", "c"].map((k) => edge(k, "ui", 20))];
  assert.deepEqual(markMajor(es, kids), []);
  assert.ok(es.filter((e) => e.b === "ui").every((e) => e.major && e.hub));
});
