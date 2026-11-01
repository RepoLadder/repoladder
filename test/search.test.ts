import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { buildIndex, find, score } from "../src/viewer/search.ts";
import type { ViewerData } from "../src/viewer/state.ts";
import { buildViewer } from "../src/build/viewer.ts";

const modelOf = (name: string): Model => {
  const facts = analyze(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  const g = defaultGrouping(facts);
  return buildModel(facts, g, assign(g, facts).leafOf);
};
// The page keeps paths inline when they are strings, and collections as flat arrays (see build/html.ts).
const pageData = (m: Model) => ({
  ...m, paths: [], layout: {},
  boards: Object.fromEntries(Object.entries(m.boards).map(([id, b]) => [id, { ...b, collections: b.collections && Object.fromEntries(Object.entries(b.collections).map(([s, cs]) => [s, cs.map((c) => [c.name, c.reads, c.writes])])) }])),
}) as unknown as ViewerData;

test("model: leaf nodes list the endpoints defined in their files", () => {
  const m = modelOf("multi");
  const withEp = Object.values(m.nodes).filter((n) => n.endpoints).map((n) => [n.id, n.endpoints]);
  assert.deepEqual(withEp, [["functions", ["GET /users/:id", "api", "nightly", "ping", "pingHttp"]]]);
});

test("model and search: endpoints are labelled with their methods, one row per method and path (#244)", () => {
  const m = modelOf("servers/hono-openapi");
  const labels = Object.values(m.nodes).flatMap((n) => n.endpoints ?? []);
  for (const l of ["GET /api/tasks", "POST /api/tasks", "GET /api/tasks/{id}", "GET /api/internal"]) assert.ok(labels.includes(l), l);
  const hits = find(buildIndex(pageData(m)), "/api/tasks").filter((h) => h[0] === "endpoint").map((h) => h[1]);
  assert.ok(hits.includes("GET /api/tasks") && hits.includes("POST /api/tasks"), hits.join(" | "));
  // search hits use exactly the panel row text
  for (const h of hits) assert.ok(labels.includes(h), h);
});

test("search: substring beats scattered, word starts and contiguous runs rank higher", () => {
  assert.equal(score("xyz", "billing.ts"), -1);
  assert.ok(score("bill", "billing.ts") > score("bill", "rebill.ts"));
  assert.ok(score("bill", "rebill.ts") > score("bl", "billing.ts"));
  assert.ok(score("cks", "createCheckoutSession") > score("cks", "zzcxkxs"));
  assert.ok(score("ping", "ping") > score("ping", "pingHttp"));
  assert.ok(score("chkout", "checkout.ts") > 0);
  assert.equal(score("createcheckoutsession", "web/scripts/extractLegalPdf.mjs"), -1, "too spread out");
});

test("search: index covers groups, files, endpoints, services and collections and finds them", () => {
  const ix = buildIndex(pageData(modelOf("multi")));
  const kinds = new Set(ix.map((h) => h[0]));
  for (const k of ["part", "file", "endpoint", "service"]) assert.ok(kinds.has(k), k);
  assert.deepEqual(find(ix, "pinghttp")[0], ["endpoint", "pingHttp", "Functions", "functions"]);
  assert.deepEqual(find(ix, "api.ts")[0].slice(0, 2), ["file", "web/src/api.ts"]);
  assert.deepEqual(find(ix, "stripe")[0].slice(0, 2), ["service", "Stripe"], "an exact name beats a file starting with it");
  assert.deepEqual(find(ix, "   "), []);
  assert.deepEqual(find(ix, "zzzzqqq"), [], "no basename bonus without a match");

  const st = buildIndex(pageData(modelOf("stores")));
  const c = st.filter((h) => h[0] === "collection");
  assert.ok(c.length > 0 && c.every(([, , , node, board]) => node.startsWith("store-") && board));
  assert.equal(new Set(c.map((h) => h[3] + h[1])).size, c.length, "one hit per collection");
});

test("the search trigger keeps its class, popup hint and the / hint, with an icon and a label", () => {
  const src = readFileSync(new URL("../src/viewer/search.ts", import.meta.url), "utf8");
  assert.ok(src.includes('class="sbtn"') && src.includes('aria-haspopup="dialog"') && src.includes('aria-keyshortcuts="/"') && src.includes("<kbd>/</kbd>"));
  assert.ok(src.includes("ICONS.search") && src.includes('class="lbl"'));
});

test("the viewer bundle includes search", () => {
  assert.ok(buildViewer().js.includes("Search the diagram"));
});
