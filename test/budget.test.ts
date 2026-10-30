// Digestibility budget (#102): which laid-out boards hold too much to take in at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { MAX_FILE_BOXES } from "../src/model/fileboards.ts";
import type { Facts, Grouping } from "../src/model/schema.ts";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { lintBoard } from "../src/build/lint.ts";
import { BUDGET, boardKind, budgetBoard, budgetLines, describeBudget, hiddenFiles, lintReport, overBudget } from "../src/build/budget.ts";
import { renderIndex } from "../scripts/gallery.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const build = (name: string): Model => {
  const facts = analyze(fixtures + name);
  const g = defaultGrouping(facts);
  return buildModel(facts, g, assign(g, facts).leafOf);
};
const multi = build("multi");

type N = BoardLayout["n"][number];
/** `n` boxes in a widely spaced grid, so names stay large at the fit unless `n` is big. */
const grid = (ids: string[]): N[] => ids.map((id, i) => [id, (i % 4) * 220, Math.floor(i / 4) * 120, 160, 60, 0]);
const budgetOf = (model: Model, board: string, layout: BoardLayout) => budgetBoard(model, layout, lintBoard(model, board, layout));

test("budget: a small board is within budget", () => {
  const b = budgetOf(multi, "root", { n: grid(["web", "functions", "tools"]), e: [["web", "functions", 0, 160, 30, 220, 30]] });
  assert.equal(b.kind, "group");
  assert.equal(b.boxes, 3);
  assert.equal(b.edges, 1);
  assert.deepEqual(b.over, []);
});

test("budget: too many boxes or arrows, each with its reason", () => {
  const ids = Array.from({ length: BUDGET.boxes + 1 }, (_, i) => `x${i}`);
  const wires: BoardLayout["e"] = Array.from({ length: BUDGET.edges + 1 }, (_, i) => [`x${i % 13}`, `x${(i + 1) % 13}`, 0, 0, 0, 1, 1]);
  const b = budgetOf(multi, "root", { n: grid(ids), e: wires });
  assert.deepEqual(b.over.map((r) => r.kind), ["boxes", "edges"]);
  assert.equal(describeBudget(b).split(":")[0], "root (group)");
  assert.match(describeBudget(b), /13 boxes > 12, 21 arrows > 20/);
});

test("budget: names too small at the desktop fit", () => {
  // two boxes 6000px apart: fitting that to 1280px shrinks the names far below 11.5px
  const b = budgetOf(multi, "root", { n: [["web", 0, 0, 160, 60, 0], ["functions", 6000, 0, 160, 60, 0]], e: [] });
  assert.ok(b.namePx < BUDGET.namePx);
  assert.deepEqual(b.over.map((r) => r.kind), ["names"]);
});

/** One leaf of `n` files, each importing the first, plus a one-file leaf. */
function bigLeaf(n: number): Model {
  const files = Array.from({ length: n }, (_, i) => ({ path: `app/f${String(i).padStart(2, "0")}.ts`, pkg: "app", loc: 10 }));
  files.push({ path: "lib/util.ts", pkg: "app", loc: 5 });
  const imports = files.slice(1, n).map((f) => ({ from: f.path, to: files[0].path, line: 1, kind: "static" }));
  const facts = { version: 1, repo: "big", sha: null, packages: [], files, imports, externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [] } as unknown as Facts;
  const grouping: Grouping = { version: 1, summary: "", children: [{ id: "app", name: "App", summary: "", files: ["app/**"] }, { id: "lib", name: "Lib", summary: "", files: ["lib/**"] }] };
  return buildModel(facts, grouping, assign(grouping, facts).leafOf);
}

test("budget: a file board with a +N more box hides files, and is over budget for it", async () => {
  const m = bigLeaf(30);
  assert.equal(boardKind(m, "app"), "files");
  assert.equal(hiddenFiles(m, "app"), 30 - (MAX_FILE_BOXES - 1));
  assert.equal(hiddenFiles(m, "lib"), 0);
  assert.equal(hiddenFiles(m, "root"), 0);
  const r = lintReport(m, await layoutBoards(m));
  const app = r.budget.byBoard.find((b) => b.board === "app")!;
  assert.ok(app.over.some((x) => x.kind === "hidden" && x.value === 15));
  assert.ok(r.budget.over[0].startsWith("app (files): "), "the most crowded board comes first");
  assert.ok(budgetLines(r).every((l) => l.startsWith("OVER_BUDGET ")));
  // a leaf at the cap draws every file
  assert.equal(hiddenFiles(bigLeaf(MAX_FILE_BOXES), "app"), 0);
});

test("budget: worst first, ties by board id", () => {
  const mk = (board: string, boxes: number) => ({ board, kind: "group" as const, boxes, edges: 0, crossings: 0, namePx: 14, hiddenFiles: 0, over: boxes > 12 ? [{ kind: "boxes" as const, value: boxes, limit: 12, detail: "" }] : [] });
  assert.deepEqual(overBudget([mk("a", 13), mk("b", 30), mk("c", 5), mk("d", 13)]).map((b) => b.board), ["b", "a", "d"]);
});

// The fixtures are small repos: every board fits the budget, except where noted.
for (const name of readdirSync(fixtures).sort()) {
  test(`budget: fixture ${name}`, async () => {
    const model = build(name);
    const r = lintReport(model, await layoutBoards(model));
    assert.equal(r.budget.boards, r.boards.length);
    assert.deepEqual(r.budget.byBoard.map((b) => b.board), r.boards.map((l) => l.board));
    for (const b of r.budget.byBoard) assert.equal(b.hiddenFiles, 0, b.board);
    assert.deepEqual(r.budget.over, [], name);
  });
}

test("gallery: the index shows how many boards are over budget", () => {
  const html = renderIndex([{ name: "x", shape: "", source: "local", sha: null, local: true, status: "ok", grouping: "custom", warnings: [], budget: { boards: 9, over: ["web (files): 20 boxes > 12"] } }], { repoladderSha: "abc", totalMs: 1 });
  assert.match(html, /title="web \(files\): 20 boxes &gt; 12">1<span class="muted"> \/ 9<\/span>/);
  assert.match(html, /over budget 1\/9: web \(files\): 20 boxes &gt; 12/);
});

test("budget: a store board too full for its readers counts only its collections", async () => {
  const facts = analyze(fixtures + "stores");
  const g: Grouping = { version: 1, summary: "", children: [
    { id: "web", name: "Web", summary: "", files: ["web/**"] },
    { id: "backend", name: "Backend", summary: "", children: [
      { id: "admin", name: "Admin", summary: "", files: ["functions/**"] },
      { id: "users", name: "Users", summary: "", files: ["server/src/users.ts"] },
      { id: "supa", name: "Supa", summary: "", files: ["server/src/orders.ts"] },
    ] },
  ] };
  const files = ["functions/src/admin.ts", "web/src/orders.ts", "server/src/users.ts", "server/src/orders.ts"];
  const storeUses: Facts["storeUses"] = [];
  for (let i = 0; i < 11; i++) for (const file of files) storeUses.push({ store: "firestore", collection: `T${String(i).padStart(2, "0")}`, op: "read", file, line: 1 + i });
  const f: Facts = { ...facts, stores: [{ id: "firestore", name: "Firestore" }], storeFields: [], storeUses };
  const model = buildModel(f, g, assign(g, f).leafOf);
  const layout = await layoutBoards(model, { only: ["store-firestore"] });
  const b = budgetOf(model, "store-firestore", layout["store-firestore"]);
  assert.deepEqual([b.kind, b.boxes], ["store", 11]);
  assert.ok(!b.over.some((r) => r.kind === "boxes"));
});
