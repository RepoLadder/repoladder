import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { boxSizes, d2Source, type BoardLayout } from "../src/build/layout.ts";
import { MAX_FILE_BOXES, MORE } from "../src/model/fileboards.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Facts, Grouping } from "../src/model/schema.ts";

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const multiGrouping = defaultGrouping(multi);
const multiModel = buildModel(multi, multiGrouping, assign(multiGrouping, multi).leafOf);

test("facts carry each file's export names, sorted, without default", () => {
  const f = (p: string) => multi.files.find((x) => x.path === p)!;
  assert.deepEqual(f("functions/src/index.ts").exports, ["api", "helper", "nightly", "ping", "pingHttp"]);
  assert.equal(f("tools/seed.cjs").exports, undefined);
});

test("every leaf opens into a board of its files, with real edges and context boxes", () => {
  for (const n of Object.values(multiModel.nodes)) if (!n.children.length && n.id !== "root") assert.ok(multiModel.boards[n.id], n.id);
  const web = multiModel.boards.web;
  assert.deepEqual(web.nodes, ["f:web/src/api.ts", "f:web/src/main.ts", "functions", "svc-firebase-auth"]);
  assert.deepEqual(web.context, ["functions"]);
  const e = (a: string, b: string) => web.edges.find((x) => x.a === a && x.b === b)!;
  assert.deepEqual(e("f:web/src/api.ts", "f:web/src/main.ts").ev, [["web/src/api.ts", 2, "web/src/main.ts"]]);
  // runtime calls into another part go to that part's context box, with the call sites as evidence
  const calls = e("f:web/src/api.ts", "functions");
  assert.equal(calls.calls, 3);
  assert.ok(calls.major);
  assert.deepEqual(calls.ev[0], ["web/src/api.ts", 4, "ping (functions/src/index.ts)"]);
  // and from the other side, the calling part points at the file that defines the endpoint
  assert.equal(multiModel.boards.functions.edges.find((x) => x.a === "web" && x.b === "f:functions/src/server.ts")?.calls, 1);
  assert.deepEqual(multiModel.files!["functions/src/index.ts"], { loc: 11, exports: ["api", "helper", "nightly"] });
});

/** One leaf of `n` files where each file i imports file 0 and file i-1, plus a second leaf that file 1 imports. */
function bigLeaf(n: number): { facts: Facts; grouping: Grouping } {
  const files = Array.from({ length: n }, (_, i) => ({ path: `app/f${String(i).padStart(2, "0")}.ts`, pkg: "app", loc: 10 + i }));
  files.push({ path: "lib/util.ts", pkg: "app", loc: 5 });
  const imports = files.slice(1, n).flatMap((f, j) => [
    { from: f.path, to: files[0].path, line: 1, kind: "static" },
    ...(j > 0 ? [{ from: f.path, to: files[j].path, line: 2, kind: "static" }] : []),
  ]);
  imports.push({ from: files[1].path, to: "lib/util.ts", line: 3, kind: "static" });
  const facts = { version: 1, repo: "big", sha: null, packages: [], files, imports, externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [] } as unknown as Facts;
  const grouping: Grouping = { version: 1, summary: "", children: [{ id: "app", name: "App", summary: "", files: ["app/**"] }, { id: "lib", name: "Lib", summary: "", files: ["lib/**"] }] };
  return { facts, grouping };
}

test("a big leaf draws its best-connected files and rolls the rest into a +more box", () => {
  const { facts, grouping } = bigLeaf(30);
  const m = buildModel(facts, grouping, assign(grouping, facts).leafOf);
  const b = m.boards.app;
  const files = b.nodes.filter((id) => id.startsWith("f:"));
  assert.equal(files.length, MAX_FILE_BOXES - 1);
  assert.ok(b.nodes.includes(MORE));
  assert.ok(files.includes("f:app/f00.ts"), "the file everyone imports is drawn");
  // imports from hidden files are kept, attributed to the +more box
  const fromMore = b.edges.filter((e) => e.a === MORE).reduce((n, e) => n + e.imports, 0);
  const hidden = 30 - files.length;
  assert.ok(fromMore >= hidden, `${fromMore} imports from ${hidden} hidden files`);
  // f00 is imported by every other file, and every one of those arrows is drawn: the file rung has no hubs (#449)
  assert.deepEqual(b.hubs, []);
  assert.deepEqual(b.throughout, []);
  assert.ok(b.edges.every((e) => e.major));
  assert.equal(b.edges.filter((e) => e.b === "f:app/f00.ts").length, files.length - 1 + 1, "an arrow from every other file, hidden ones through +more");
  // the other part shows up as a context box
  assert.deepEqual(b.context, ["lib"]);
  assert.deepEqual(m.boards.lib.nodes, ["f:lib/util.ts", "app"]);
});

test("file boards lay out under aliases, since paths hold dots and slashes", () => {
  const src = d2Source(multiModel, "web");
  // boxes carry no D2 label: the viewer draws the text, and a tall D2 label would grow ELK's box
  assert.match(src, /^n0: "" { width: \d+; height: \d+ }$/m);
  assert.match(src, /^n2: "" { width: \d+; height: \d+ }$/m);
  // counts live in the connection panel, so arrows reserve no label room in D2
  assert.match(src, /^n0 -> n2$/m);
  assert.match(src, /^n0 -> n1$/m);
  assert.ok(!src.includes("web/src"));
  // file boxes share one size, whatever their lines of code, like parts on group boards
  const size = boxSizes(multiModel, "functions");
  assert.deepEqual(size["f:functions/src/index.ts"], size["f:functions/src/server.ts"]);
});

test("the page refers to files by path index and ships its data deflated", () => {
  const layout: Record<string, BoardLayout> = {};
  for (const [id, b] of Object.entries(multiModel.boards)) layout[id] = { n: b.nodes.map((n, i) => [n, i * 100, 0, 80, 40, 0]), e: b.edges.filter((e) => e.major).map((e) => [e.a, e.b, 0, 0, 0, 10, 10]) };
  const html = renderHtml(multiModel, layout);
  assert.equal(html, renderHtml(multiModel, layout), "deterministic");
  const data = pageData(html);
  const at = (p: string) => `@${data.paths.indexOf(p)}`;
  assert.deepEqual(data.boards.web.nodes, [at("web/src/api.ts"), at("web/src/main.ts"), "functions", "svc-firebase-auth"]);
  assert.deepEqual(data.layout.web.n[0][0], at("web/src/api.ts"));
  assert.deepEqual(data.files[at("web/src/api.ts")], [7, "label", "ping", "pingHttp"]);
  assert.ok(!html.includes("web/src/api.ts"), "nothing readable leaks outside the packed data");
});

test("file boxes deep-link as _<index> tokens", async () => {
  const { hashFor, parseHash } = await import("../src/viewer/deeplink.ts");
  const node = (parent: string | null, children: string[] = []) => ({ name: "x", parent, children, files: [], count: 1, loc: 1 });
  const data = {
    repo: "r", sha: null, paths: ["a.ts", "b.ts"], services: {},
    nodes: { root: node(null, ["app"]), app: node("root") },
    boards: { root: { nodes: ["app"], edges: [], throughout: [], hubs: [], context: [] }, app: { nodes: ["@0", "@1", "+more"], edges: [{ a: "@0", b: "@1", imports: 1, calls: 0, uses: 0, major: true, ev: [] }], throughout: [], hubs: [], context: [] } },
    layout: { root: { n: [["app", 0, 0, 1, 1, 0]], e: [] }, app: { n: [["@0", 0, 0, 1, 1, 0], ["@1", 0, 0, 1, 1, 0], ["+more", 0, 0, 1, 1, 0]], e: [] } },
    files: { "@0": [1], "@1": [2] },
  } as any;
  assert.equal(hashFor(data, "app", "n:@0"), "_0");
  assert.deepEqual(parseHash(data, "#_0"), { board: "app", hit: "n:@0" });
  assert.equal(hashFor(data, "app", "e:@0>@1"), "_0._1");
  assert.deepEqual(parseHash(data, "#_0._1"), { board: "app", hit: "e:@0>@1" });
  assert.deepEqual(parseHash(data, "#_more"), { board: "app", hit: "n:+more" });
});
