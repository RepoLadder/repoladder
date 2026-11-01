import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData, pageParts } from "../src/build/filepack.ts";
import { FONT_KB, VIEWER_KB, budgetKb, describeSize, overBudget, pageSize } from "../src/build/pagesize.ts";
import type { BoardLayout } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { decode91, encode91 } from "../src/viewer/base91.ts";
import type { ViewerData } from "../src/viewer/state.ts";
import { unpack } from "../src/viewer/unpack.ts";
import { decodeWire, encodeWire } from "../src/viewer/wire.ts";

const page = (fixture: string) => {
  const facts = analyze(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)));
  const g = defaultGrouping(facts);
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  const layout: Record<string, BoardLayout> = {};
  for (const [id, b] of Object.entries(model.boards)) layout[id] = { n: b.nodes.map((n, i) => [n, i * 100, 0, 80, 40, 0]), e: b.edges.map((e, i) => [e.a, e.b, e.major ? 1 : 0, 3 * i, 7, 3 * i + 40, 90, 5, 260]) };
  return renderHtml(model, layout);
};

test("basE91 round-trips any bytes and stays inside a double-quoted script string", () => {
  for (const n of [0, 1, 2, 3, 13, 14, 255, 1000, 4097]) {
    const bytes = new Uint8Array(randomBytes(n));
    const s = encode91(bytes);
    assert.deepEqual(decode91(s), bytes, `length ${n}`);
    assert.doesNotMatch(s, /["\\<\s]/);
  }
  assert.deepEqual(decode91(encode91(new Uint8Array(500).fill(0))), new Uint8Array(500));
  assert.deepEqual(decode91(encode91(new Uint8Array(500).fill(255))), new Uint8Array(500).fill(255));
});

test("the wire format is lossless, key order included", () => {
  const data = {
    repo: "r", sha: null, paths: ["a.ts", "b.ts", "c.ts"], services: { "svc-x": "X" },
    nodes: { root: { id: "root", name: "R", summary: "", parent: null, children: ["p"], files: [], count: 3, loc: 9 }, p: { id: "p", name: "P", summary: "", parent: "root", children: [], files: [2, 0, 1, "odd"], count: 3, loc: 9 } },
    boards: {
      root: { nodes: ["p", "svc-x"], context: [], hubs: [], edges: [], throughout: [] },
      p: {
        nodes: ["@0", "@1"], context: [], hubs: [], throughout: [],
        edges: [
          { a: "@0", b: "@1", imports: 2, calls: 0, uses: 0, major: true, ev: [[0, 3, 1], [0, 9, "x (y)"]] },
          { a: "@1", b: "svc-x", imports: 0, calls: 0, uses: 4, major: false, ev: [[1, 2, "Users (read)"]], reads: 3, writes: 1 },
          { a: "@1", b: "@0", imports: 1, calls: 1, uses: 0, major: true, ev: [], hub: true },
        ],
      },
    },
    layout: {
      p: {
        n: [["@1", 100, 0, 80, 40, 0], ["@0", 0, 0, 80, 40, 0], ["far", 0, 90, 80, 40, 1]],
        e: [
          ["@0", "@1", 1, 10, 20, 15, 18, 40, 60], ["@1", "@0", 0],
          // right-angled routes, x first and y first, and ones that can't be squashed (a zero step, two steps on one axis)
          ["@0", "@1", 0, 80, 20, 90, 20, 90, 60, 100, 60], ["@1", "svc-x", 1, 140, 40, 140, 70, 120, 70],
          ["@0", "@1", 0, 80, 20, 80, 20, 90, 20], ["@0", "@1", 0, 80, 20, 85, 20, 100, 20], ["@0", "far", 0, 40, 40, 40, 90],
        ],
      },
    },
    flows: {
      p: [
        { title: "a → b", path: ["@0", "@1"] },
        { title: "a → X via b", path: ["@0", "@1", "svc-x"] },
        { title: "Login", path: ["@0", "@1", "svc-x"], captions: ["one", "two"] },
        { title: "a → far", path: ["@0", "far"] },
      ],
    },
    // file pairs: evidence already on a board (an import and a call), and evidence only here
    fgraph: [[0, 1, 2, 0, 3], [0, 2, 0, 1, 9, "x (y)"], [1, 2, 1, 0, 5], [2, 0, 3, 1, 1]],
  } as unknown as ViewerData;
  const wire = encodeWire(data);
  assert.equal(JSON.stringify(decodeWire(JSON.parse(JSON.stringify(wire)))), JSON.stringify(data));
  assert.deepEqual(wire.layout.p.e.map((e) => e[2]), [1, 0, 2, 5, 0, 0, 4], "right-angled routes are squashed, with the first axis in the flag");
  assert.deepEqual(wire.flows!.p.map((f) => f[1]), [0, 1, "Login", 0], "derived titles are rebuilt; others travel as text");
  assert.deepEqual(wire.boards.p.edges[0], [0, 1, 1], "edge ends are indexes into the board's boxes");
  assert.equal(wire.ev[0].length, 5, "evidence is stored once, the file graph's too");
  assert.deepEqual(wire.fg, [[0, 1, 2, 1], [2, 0, 1, 3], [0, 1, 0, 1], [2]], "file pairs are evidence rows (as deltas), with the call's to file kept");
  for (const fixture of ["multi", "stores"]) {
    const d = pageData(page(fixture));
    assert.equal(JSON.stringify(decodeWire(encodeWire(d))), JSON.stringify(d), fixture);
  }
});

test("the viewer unpacks what the page ships", async () => {
  const html = page("stores");
  // plus the group tree it adds (viewer/finetree.ts): without splits, Default's own nodes
  const { tree, ...shipped } = await unpack(pageParts(html).data, decode91);
  assert.deepEqual(shipped, pageData(html));
  assert.equal(tree, shipped.nodes);
  assert.ok(pageData(html).boards.root.edges.some((e: { reads?: number }) => e.reads), "store edges keep their read counts");
});

test("page size breaks the bytes down and flags pages over budget", () => {
  const html = page("stores");
  const s = pageSize(html);
  assert.equal(s.total, Buffer.byteLength(html));
  assert.ok(s.js > 10_000 && s.css > 5_000 && s.data > 0 && s.rawData > s.data);
  assert.ok(s.fonts > 0 && s.js + s.css + s.data + s.fonts < s.total);
  assert.ok(Buffer.byteLength(pageParts(html).fonts!) < FONT_KB * 1024);
  assert.ok(Math.abs(Object.values(s.sections).reduce((a, b) => a + b, 0) - s.data) <= 9, "sections add up to the packed data");
  assert.match(describeSize(s), /^\d+\.\dKB = viewer .* \+ data .*evidence.* \+ fonts \d+\.\dKB$/);
  assert.equal(budgetKb(0), VIEWER_KB + FONT_KB);
  assert.ok(overBudget(290, 121), "A large app at 290KB (121 boards) is over the budget");
  assert.ok(!overBudget(153.2, 121), "A large app with the viewer packed (153.2KB) is under");
  assert.ok(overBudget(VIEWER_KB + FONT_KB + 1, 0) && !overBudget(VIEWER_KB + FONT_KB - 1, 0), "the viewer and fonts alone have to fit");
  assert.ok(s.js + s.css < VIEWER_KB * 1024, `the packed viewer and its boot script are ${s.js + s.css} bytes`);
  assert.ok(Buffer.byteLength(html) / 1024 < budgetKb(Object.keys(pageData(html).boards).length), "the fixture page is under budget");
});

test("pageSize counts the boot script: js exceeds the packed viewer's own bytes", () => {
  const html = page("stores");
  const s = pageSize(html);
  assert.ok(s.js + s.css > Buffer.byteLength(pageParts(html).viewer), "the repoladderBoot( regex matched a non-empty boot script");
});

test("pageParts still parses a page from before the fonts were embedded", () => {
  const html = page("stores");
  const old = html.replace(/(repoladderBoot\("[^"]*","[^"]*"),"[^"]*"\);/, "$1);");
  assert.notEqual(old, html);
  const p = pageParts(old);
  assert.equal(p.fonts, undefined);
  assert.equal(p.data, pageParts(html).data);
  assert.equal(pageSize(old).fonts, 0);
});
