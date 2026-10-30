// #449: every connection is an arrow on at least one rung. Group boards declutter; the file rung
// (a leaf's file board) draws every connection of its files; drawingRungs checks it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { analyze } from "../src/analyze/index.ts";
import { fileArrowWarnings, lintReport } from "../src/build/budget.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { drawingRungs, isDrawn } from "../src/model/drawn.ts";
import { MAX_FILE_BOXES, MORE } from "../src/model/fileboards.ts";
import { passesThrough } from "../src/model/fgraph.ts";
import { BOX_BUDGET, EDGE_BUDGET } from "../src/model/budgetsplit.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import type { Facts, Grouping } from "../src/model/schema.ts";

const p = (leaf: string, i: number) => `${leaf}/f${String(i).padStart(2, "0")}.ts`;

/**
 * "app": 30 files, f00 imported by all (a hub), a chain, a few calls, Firestore used by 6 files
 * (more than the old "used throughout" limit) and a second service; "lib": 3 files that app imports.
 */
function dense(): { facts: Facts; authored: Grouping } {
  const files = [...Array.from({ length: 30 }, (_, i) => ({ path: p("app", i), pkg: "app", loc: 10 })), ...[0, 1, 2].map((i) => ({ path: p("lib", i), pkg: "app", loc: 5 }))];
  const imp = (from: string, to: string, line = 1) => ({ from, to, line, kind: "static" as const });
  const imports = [
    ...Array.from({ length: 29 }, (_, i) => imp(p("app", i + 1), p("app", 0))),
    ...Array.from({ length: 28 }, (_, i) => imp(p("app", i + 2), p("app", i + 1), 2)),
    imp(p("app", 1), p("lib", 0)), imp(p("app", 29), p("lib", 1)), imp(p("lib", 2), p("app", 3)),
  ];
  const serviceUses = [0, 5, 9, 14, 20, 28].map((i) => ({ from: p("app", i), service: "stripe", spec: "stripe", line: 3 }));
  const storeUses = [1, 2, 3, 4, 25, 29].map((i) => ({ store: "firestore", collection: "Orders", op: "read" as const, file: p("app", i), line: 4 }));
  const facts = {
    version: 1, repo: "dense", sha: null, github: null, packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }], files, imports, externals: [], unresolved: [],
    services: [{ id: "stripe", name: "Stripe" }], serviceUses, stores: [{ id: "firestore", name: "Firestore" }], storeUses, storeFields: [], endpoints: [], calls: [], pages: [], routeFiles: [],
  } as unknown as Facts;
  const authored: Grouping = { version: 1, summary: "", children: [{ id: "app", name: "App", summary: "", files: ["app/**"] }, { id: "lib", name: "Lib", summary: "", files: ["lib/**"] }] };
  return { facts, authored };
}
const modelOf = (facts: Facts, g: Grouping) => buildModel(facts, g, assign(g, facts).leafOf);

test("the file rung draws every import, every outward connection and every service and store", () => {
  const { facts, authored } = dense();
  const small = { ...facts, files: facts.files.filter((f) => !f.path.startsWith("app/") || Number(f.path.slice(5, 7)) < 14) };
  const keep = new Set(small.files.map((f) => f.path));
  const f = { ...small, imports: facts.imports.filter((i) => keep.has(i.from) && keep.has(i.to)), serviceUses: facts.serviceUses.filter((u) => keep.has(u.from)), storeUses: facts.storeUses.filter((u) => keep.has(u.file)) } as Facts;
  const m = modelOf(f, authored);
  const b = m.boards.app;
  assert.ok(!b.nodes.includes(MORE), "14 files fit without a +more box");
  assert.ok(b.edges.length > 0 && b.edges.every((e) => e.major), "every edge on a file board is drawn");
  assert.deepEqual(b.hubs, []);
  assert.deepEqual(b.throughout, []);
  // f00 is imported by every other file: all 13 arrows drawn, none hidden as a hub
  assert.equal(b.edges.filter((e) => e.b === "f:app/f00.ts").length, 13);
  // Stripe is used by 4 files here (f00, f05, f09 ...), Firestore by 4: both are drawn
  assert.ok(b.nodes.includes("svc-stripe") && b.nodes.includes("store-firestore"));
  assert.ok(b.edges.some((e) => e.b === "store-firestore") && b.edges.some((e) => e.b === "svc-stripe"));
  // the part elsewhere gets its arrows, one box merged per outside part
  assert.deepEqual(b.context, ["lib"]);
  assert.ok(b.edges.some((e) => e.b === "lib" && e.major));
});

test("authored grouping: connected hidden files draw arrows from the +more box, and nothing is split", () => {
  const { facts, authored } = dense();
  const m = modelOf(facts, authored);
  const b = m.boards.app;
  assert.ok(b.nodes.includes(MORE));
  assert.equal(b.nodes.filter((id) => id.startsWith("f:")).length, MAX_FILE_BOXES - 1);
  const fromMore = b.edges.filter((e) => e.a === MORE || e.b === MORE);
  assert.ok(fromMore.length > 0);
  assert.ok(fromMore.every((e) => e.major), "arrows to and from +more are drawn");
  // 14 of 29 stripe/firestore uses may come from hidden files; any use from a hidden file is an arrow from +more
  assert.ok(b.edges.every((e) => e.major));
  // two hidden files that import each other stay out of the edges (no self-loop), and are reported undrawn
  assert.ok(!b.edges.some((e) => e.a === e.b));
  const r = drawingRungs(facts, m);
  assert.ok(r.undrawn > 0);
  assert.ok(r.list.every((u) => u.reason === "hidden"));
  assert.equal(r.undrawn, r.list.length);
  assert.ok(r.connections > 0);
  assert.equal(isDrawn(facts, m, p("app", 1), p("lib", 0)), true);
  assert.equal(isDrawn(facts, m, p("app", 1), p("lib", 0)), true, "memoised call agrees");
  assert.equal(m.version, 1);
});

test("authored grouping: dense or hiding boards get a warning naming the leaf", async () => {
  const { facts, authored } = dense();
  const m = modelOf(facts, authored);
  const report = lintReport(m, await layoutBoards(m));
  const w = fileArrowWarnings(m, report, facts);
  assert.ok(w.some((x) => /^app: over budget because of \d+ file arrows$/.test(x)), w.join("\n"));
  assert.ok(w.some((x) => /^app: \d+ connections? touch files hidden in \+\d+ more$/.test(x)), w.join("\n"));
  assert.ok(!w.some((x) => x.startsWith("lib:")));
});

test("default grouping: the dense leaf is split, no connected file is hidden, nothing is undrawn", () => {
  const { facts } = dense();
  const g = defaultGrouping(facts);
  const m = modelOf(facts, g);
  for (const [id, b] of Object.entries(m.boards)) {
    if (!m.nodes[id]) continue;
    assert.ok(!b.nodes.includes(MORE), `${id} hides files`);
    assert.ok(b.nodes.length <= BOX_BUDGET, `${id}: ${b.nodes.length} boxes`);
    assert.ok(b.edges.filter((e) => e.major).length <= EDGE_BUDGET, `${id}: ${b.edges.filter((e) => e.major).length} arrows`);
  }
  const r = drawingRungs(facts, m);
  assert.equal(r.undrawn, 0, JSON.stringify(r.list.slice(0, 3)));
  assert.equal(r.outsideLeaves, 0);
});

/** The property, checked without drawingRungs: each connection's two files meet on some board as a major edge. */
function everyPairDrawn(facts: Facts, m: Model): string[] {
  const leafOf = new Map<string, string>();
  for (const n of Object.values(m.nodes)) if (!n.children.length) for (const f of n.files) leafOf.set(f, n.id);
  const chain = (leaf: string) => { const c: string[] = []; for (let id: string | null = leaf; id && id !== "root"; id = m.nodes[id].parent) c.unshift(id); return c; };
  const missing: string[] = [];
  const pairs = [...facts.imports.filter((i) => !passesThrough(i)), ...facts.calls].filter((e) => e.from !== e.to && leafOf.has(e.from) && leafOf.has(e.to));
  for (const e of pairs) {
    const ca = chain(leafOf.get(e.from)!), cb = chain(leafOf.get(e.to)!);
    const boxes = (board: string, f: string, own: string[]): string | null => {
      const c = chain(leafOf.get(f)!);
      if (leafOf.get(f) === board) return m.boards[board].nodes.includes(`f:${f}`) ? `f:${f}` : MORE;
      if (board === "root") return c[0];
      if (own.every((x, i) => c[i] === x)) return c[own.length] ?? null;
      const i = own.findIndex((x, k) => c[k] !== x);
      return i < 0 ? null : c[i];
    };
    let ok = false;
    for (const board of new Set(["root", ...ca, ...cb])) {
      const own = board === "root" ? [] : chain(board);
      const a = boxes(board, e.from, own), b = boxes(board, e.to, own);
      if (a && b && a !== b && m.boards[board]?.edges.some((x) => x.major && x.a === a && x.b === b)) { ok = true; break; }
    }
    if (!ok) missing.push(`${e.from} -> ${e.to}`);
  }
  return missing;
}

test("every import and call between files in leaves is a major arrow somewhere (default groupings)", () => {
  const { facts } = dense();
  assert.deepEqual(everyPairDrawn(facts, modelOf(facts, defaultGrouping(facts))), []);
  const dir = fileURLToPath(new URL("./fixtures", import.meta.url));
  for (const name of readdirSync(dir).sort()) {
    const f = analyze(`${dir}/${name}`);
    const g = defaultGrouping(f);
    const m = modelOf(f, g);
    assert.deepEqual(everyPairDrawn(f, m), [], name);
    const r = drawingRungs(f, m);
    assert.equal(r.undrawn, 0, `${name}: ${JSON.stringify(r.list.slice(0, 3))}`);
  }
});

test("drawingRungs stays cheap on a big map", () => {
  const n = 1500;
  const files = Array.from({ length: n }, (_, i) => ({ path: `src/d${String(i % 40).padStart(2, "0")}/f${i}.ts`, pkg: "app", loc: 10 }));
  const imports = files.flatMap((f, i) => [1, 7, 31].map((k) => ({ from: f.path, to: files[(i + k) % n].path, line: 1, kind: "static" as const })));
  const facts = { version: 1, repo: "big", sha: null, github: null, packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }], files, imports, externals: [], unresolved: [], services: [], serviceUses: [], stores: [], storeUses: [], storeFields: [], endpoints: [], calls: [], pages: [], routeFiles: [] } as unknown as Facts;
  const m = modelOf(facts, defaultGrouping(facts));
  const t = performance.now();
  const r = drawingRungs(facts, m);
  const ms = performance.now() - t;
  assert.ok(r.connections > 3000, JSON.stringify({ c: r.connections, o: r.outsideLeaves, u: r.undrawn }));
  assert.ok(ms < 2000, `${Math.round(ms)}ms`);
});
