// The file-level graph (#142): what model/fgraph.ts keeps, that it rolls up to the same counts
// as the boards, and that the page ships it intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageSize } from "../src/build/pagesize.ts";
import { fileGraph } from "../src/model/fgraph.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Facts } from "../src/model/schema.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test("fileGraph: one row per pair, counted like the boards, with the first evidence", () => {
  const leafOf = new Map(["a.ts", "b.ts", "c.ts", "d.ts"].map((f) => [f, "leaf"]));
  const facts: Pick<Facts, "imports" | "calls"> = {
    imports: [
      { from: "a.ts", to: "b.ts", line: 2, kind: "static" },
      { from: "a.ts", to: "b.ts", line: 5, kind: "type" },
      { from: "a.ts", to: "a.ts", line: 6, kind: "static" }, // self
      { from: "a.ts", to: "out.ts", line: 7, kind: "static" }, // not on any board
      { from: "b.ts", to: "c.ts", line: 1, kind: "reexport" }, // barrel: rollup skips it too
      { from: "d.ts", to: "c.ts", line: 4, kind: "lazy" },
    ],
    calls: [
      { from: "a.ts", to: "b.ts", line: 9, endpoint: "pay", kind: "callable" },
      { from: "c.ts", to: "d.ts", line: 3, endpoint: "/api/x", kind: "http" },
      { from: "c.ts", to: "d.ts", line: 8, endpoint: "/api/y", kind: "http" },
    ],
  };
  assert.deepEqual(fileGraph(facts, leafOf), [
    ["a.ts", "b.ts", 2, 1, 2],
    ["c.ts", "d.ts", 0, 2, 3, "/api/x (d.ts)"],
    ["d.ts", "c.ts", 1, 0, 4],
  ]);
});

test("the file graph rolls up to every group board's edge counts", () => {
  const dir = fixture("deep");
  const facts = analyze(dir);
  const grouping = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
  const a = assign(grouping, facts);
  const model = buildModel(facts, grouping, a.leafOf);
  assert.ok(model.fgraph && model.fgraph.length >= 8);
  const { nodes } = model;
  const chain = (file: string) => { const out: string[] = []; for (let n: string | null = a.leafOf.get(file)!; n; n = nodes[n].parent) out.unshift(n); return out; };
  let checked = 0, edges = 0;
  for (const n of Object.values(nodes)) {
    if (!n.children.length) continue;
    const childOf = (f: string) => { const c = chain(f); const i = c.indexOf(n.id); return i < 0 ? null : c[i + 1] ?? null; };
    const sums = new Map<string, [number, number]>();
    for (const [f, t, imports, calls] of model.fgraph) {
      const x = childOf(f), y = childOf(t);
      if (!x || !y || x === y) continue;
      const s = sums.get(`${x}>${y}`) ?? [0, 0];
      sums.set(`${x}>${y}`, [s[0] + imports, s[1] + calls]);
    }
    const drawn = new Map(model.boards[n.id].edges.filter((e) => n.children.includes(e.a) && n.children.includes(e.b)).map((e) => [`${e.a}>${e.b}`, [e.imports, e.calls]]));
    assert.deepEqual(new Map([...sums].sort()), new Map([...drawn].sort()), n.id);
    checked++; edges += drawn.size;
  }
  assert.ok(checked >= 4 && edges >= 4, `${checked} group boards, ${edges} edges`);
});

test("the page carries the file graph by path index, and pagesize reports it", () => {
  const facts = analyze(fixture("multi"));
  const g = defaultGrouping(facts);
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  const html = renderHtml(model, {});
  const d = pageData(html);
  assert.deepEqual(d.fgraph.map(([x, y, ...r]: [number, number]) => [d.paths[x], d.paths[y], ...r]), model.fgraph);
  assert.ok(pageSize(html).sections.fgraph > 0);
});
