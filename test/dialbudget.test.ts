// Detail dial v2 (#170, docs/detail-dial-v2.md): a stop is a box budget per board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import type { PageNode, ViewerData } from "../src/viewer/state.ts";
import { cut, drawnHolder, extraBoxes, layersAt, stopsFor } from "../src/viewer/budget.ts";

const deep = (): ViewerData => {
  const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));
  const g = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
  const f = analyze(dir);
  return pageData(renderHtml(buildModel(f, g, assign(g, f).leafOf), {}));
};

/** A tree from a spec: a number is a leaf with that many files, an object a group. */
type Spec = number | { [id: string]: Spec };
function tree(spec: { [id: string]: Spec }) {
  const nodes: Record<string, PageNode & { fine?: boolean }> = {}, paths: string[] = [];
  const add = (id: string, s: Spec, parent: string | null): number => {
    const n = { id, name: id, summary: "", parent, children: [] as string[], files: [] as number[], count: 0, loc: 0 };
    nodes[id] = n;
    if (typeof s === "number") {
      for (let i = 0; i < s; i++) n.files.push(paths.push(`${id}/f${i}.ts`) - 1);
      n.count = s;
    } else for (const [c, cs] of Object.entries(s)) { n.children.push(c); n.count += add(c, cs, id); }
    return n.count;
  };
  add("root", spec, null);
  return { nodes, paths };
}

// A large app's shape: a big web app with a War room of 5 small leaves (~30 files), plus other parts
const fd = () => tree({
  web: {
    "war-room": { wr1: 7, wr2: 6, wr3: 6, wr4: 6, wr5: 5 },
    booking: { b1: 20, b2: 15, b3: 12, b4: 9 },
    settings: { s1: 30, s2: 25, s3: { s3a: 20, s3b: 18 } },
    shell: 40,
  },
  functions: { fn1: 60, fn2: 45, fn3: { fn3a: 30, fn3b: 25 } },
  kiosk: { k1: 35, k2: 28 },
  shared: 18,
});

test("Default (budget 0) draws the board's children only", () => {
  const d = deep();
  for (const id of ["root", "app", "billing", "pdf"]) {
    const c = cut(d.nodes, d.paths, id, 0);
    assert.deepEqual(c.boxes, d.nodes[id].children, id);
    assert.deepEqual(Object.keys(c.open), [id]);
  }
  const { nodes, paths } = fd();
  assert.deepEqual(cut(nodes, paths, "root", 0).boxes, ["web", "functions", "kiosk", "shared"]);
});

test("War room at budget 30 opens its 5 leaves to their 30 files", () => {
  const { nodes, paths } = fd();
  const c = cut(nodes, paths, "war-room", 30);
  assert.equal(c.boxes.length, 30);
  assert.ok(c.boxes.every((b) => b[0] === "@"));
  assert.deepEqual(Object.keys(c.open), ["war-room", "wr1", "wr2", "wr3", "wr4", "wr5"]);
  // its elsewhere lane and services count: with 3 of them, 30 files no longer fit
  const busy = cut(nodes, paths, "war-room", 30, { extra: 3 });
  assert.ok(busy.boxes.length + 3 <= 30);
  assert.ok(busy.boxes.length > 5, "biggest-first still opens what fits");
});

test("evenly a level at a time, then biggest first while it fits", () => {
  const { nodes, paths } = fd();
  // web: 4 parts, one a 40-file leaf. Opening all four (5+4+3+40) doesn't fit, so the biggest
  // open first while each fits (settings, booking, war room), and then it stops: no second level
  const c = cut(nodes, paths, "web", 30);
  assert.deepEqual(Object.keys(c.open), ["web", "settings", "booking", "war-room"]);
  assert.equal(c.boxes.length, 13);
  assert.ok(!c.open.shell, "shell's 40 files never fit in 30");
  // without the big leaf, the level opens evenly and then goes on a level deeper
  const t2 = fd();
  t2.nodes.web.children = t2.nodes.web.children.filter((x) => x !== "shell");
  const e = cut(t2.nodes, t2.paths, "web", 30);
  for (const id of ["war-room", "booking", "settings"]) assert.ok(e.open[id], id);
  assert.ok(e.open.s3, "second level: biggest first, s3 (2 parts) fits");
  assert.ok(e.boxes.length <= 30);
  // stall: one part too big to open beside the others falls back to biggest-first
  const t = tree({ a: { a1: 3, a2: 3 }, huge: { h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, h7: 1, h8: 1, h9: 1, h10: 1 } });
  const s = cut(t.nodes, t.paths, "root", 10);
  assert.ok(!s.open.huge && s.open.a, "huge (10) can't open beside a's 2; a opens");
  assert.deepEqual(s.boxes, ["a1", "a2", "huge"]);
});

test("Everything (Infinity) opens every group to files", () => {
  const d = deep();
  const c = cut(d.nodes, d.paths, "root", Infinity);
  assert.equal(c.boxes.length, d.paths.length);
  assert.deepEqual(c.boxes, d.paths.map((_, i) => `@${i}`));
});

test("drawnHolder: a file, a buried group, an off-board id", () => {
  const d = deep();
  const c = cut(d.nodes, d.paths, "billing", 0); // draws plans, invoices
  assert.equal(drawnHolder(c, d.nodes, d.paths, "invoices"), "invoices");
  assert.equal(drawnHolder(c, d.nodes, d.paths, "pdf-render"), "invoices");
  assert.equal(drawnHolder(c, d.nodes, d.paths, "@6"), "invoices");
  assert.equal(drawnHolder(c, d.nodes, d.paths, "billing"), "billing");
  assert.equal(drawnHolder(c, d.nodes, d.paths, "api"), null);
  assert.equal(drawnHolder(c, d.nodes, d.paths, "@0"), null);
  assert.equal(drawnHolder(c, d.nodes, d.paths, "app"), null, "an ancestor is not on the board");
  const all = cut(d.nodes, d.paths, "billing", Infinity);
  assert.equal(drawnHolder(all, d.nodes, d.paths, "@6"), "@6");
  assert.equal(drawnHolder(all, d.nodes, d.paths, "pdf-render"), "pdf-render", "an opened group is its own container");
});

test("a 20-file repo gets Default and Everything only", () => {
  const { nodes, paths } = tree({ ui: { u1: 4, u2: 4 }, api: { a1: 3, a2: 3 }, lib: 6 });
  assert.deepEqual(stopsFor(nodes, paths).map((s) => s.key), ["everything", "default"]);
});

test("stopsFor on a large app's tree: named ends, middle dots, budgets x2.5", () => {
  const { nodes, paths } = fd();
  const s = stopsFor(nodes, paths);
  assert.equal(s[0].key, "everything");
  assert.equal(s[0].budget, Infinity);
  assert.equal(s.at(-1)!.key, "default");
  const mid = s.slice(1, -1);
  assert.ok(mid.length >= 2, JSON.stringify(s));
  assert.deepEqual(mid.map((m) => m.key), mid.map((_, i) => `+${mid.length - i}`));
  assert.ok(mid.every((m) => [30, 75, 188, 469].includes(m.budget)));
  // no numbers on the dial (#265): the ends are More and Less, the middle stops unnamed
  assert.equal(s[0].label, "More");
  assert.ok(mid.every((m) => m.label === ""));
  // the root at a middle stop never opens all the way
  for (const m of mid) assert.ok(cut(nodes, paths, "root", m.budget).boxes.some((b) => b[0] !== "@"));
});

test("fine nodes: skipped below Simple, shown with fine, Simple listed only when present", () => {
  const { nodes, paths } = fd();
  // split shell's 40 files into two fine parts
  const files = nodes.shell.files;
  nodes["shell-a"] = { ...nodes.shell, id: "shell-a", parent: "shell", files: files.slice(0, 20), count: 20, fine: true };
  nodes["shell-b"] = { ...nodes.shell, id: "shell-b", parent: "shell", files: files.slice(20), count: 20, fine: true };
  nodes.shell = { ...nodes.shell, files: [], children: ["shell-a", "shell-b"] };
  assert.equal(stopsFor(nodes, paths).at(-1)!.key, "simple");
  assert.equal(stopsFor(nodes, paths).at(-1)!.label, "Less");
  assert.equal(cut(nodes, paths, "shell", 0).boxes.length, 40, "a split leaf at Default draws its files, as before the split");
  assert.deepEqual(cut(nodes, paths, "shell", 0, { fine: true }).boxes, ["shell-a", "shell-b"]);
  const c = cut(nodes, paths, "shell", Infinity);
  assert.equal(c.boxes.length, 40);
  assert.equal(drawnHolder(cut(nodes, paths, "web", 0), nodes, paths, "shell-a"), "shell");
  assert.equal(drawnHolder(cut(nodes, paths, "web", 0), nodes, paths, `@${files[0]}`), "shell");
});

test("extraBoxes counts a Default board's elsewhere lane and services", () => {
  const d = deep();
  assert.equal(extraBoxes(d.nodes, d.boards.app, "app"), 2); // api (elsewhere) + svc-stripe
  assert.equal(extraBoxes(d.nodes, d.boards.root, "root"), 1);
  assert.equal(extraBoxes(d.nodes, d.boards.pdf, "pdf"), 0);
});

test("containers: an opened part can count toward the budget", () => {
  const { nodes, paths } = fd();
  // free containers: War room's 30 files fit 30 exactly; at ½ a box each its 5 leaves cost 2.5 more
  assert.equal(cut(nodes, paths, "war-room", 30).boxes.length, 30);
  const half = cut(nodes, paths, "war-room", 30, { containers: 0.5 });
  const cost = half.boxes.length + 0.5 * (Object.keys(half.open).length - 1);
  assert.ok(cost <= 30 && half.boxes.length < 30, "not every leaf opens");
  assert.deepEqual(cut(nodes, paths, "war-room", 0, { containers: 0.5 }).boxes, nodes["war-room"].children, "Default is unchanged");
});

test("layersAt: Default keeps every group, Everything only the tops, a middle stop what a surviving board draws closed (#327)", () => {
  const { nodes, paths } = fd();
  const all = Object.keys(nodes).filter((id) => contents(nodes, id));
  assert.deepEqual([...layersAt(nodes, paths, 0, [["root", 0]], () => 0)].sort(), all.sort());
  assert.deepEqual([...layersAt(nodes, paths, Infinity, [["root", 0]], () => 0)], ["root"]);
  for (const budget of [8, 14, 30, 60]) {
    const ls = layersAt(nodes, paths, budget, [["root", 0]], () => 0);
    for (const b of ls) for (const x of cut(nodes, paths, b, budget).boxes) {
      if (x[0] !== "@" && nodes[x] && contents(nodes, x)) assert.ok(ls.has(x), `${x} is closed on ${b} at ${budget}`);
    }
    for (const x of Object.keys(cut(nodes, paths, "root", budget).open)) if (x !== "root") assert.ok(!ls.has(x) || [...ls].some((b) => cut(nodes, paths, b, budget).boxes.includes(x)), x);
  }
  // at 14 root opens web and functions in place: they are containers, with no board of their own
  const mid = layersAt(nodes, paths, 14, [["root", 0]], () => 0);
  assert.ok(mid.size > 1 && mid.size < all.length);
});
const contents = (nodes: Record<string, PageNode>, id: string) => nodes[id].children.length > 0 || nodes[id].files.length > 0;
