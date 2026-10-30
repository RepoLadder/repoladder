// Everything, the detail dial's top stop: the root cut at Infinity (viewer/cutboard.ts), rolled up
// from the file graph in the page by the build's rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Facts } from "../src/model/schema.ts";
import type { ViewerData } from "../src/viewer/state.ts";
import { cut } from "../src/viewer/budget.ts";
import { cutBoard } from "../src/viewer/cutboard.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const page = (facts: Facts, g: Grouping): ViewerData => pageData(renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {}));

test("Everything: one board, every group and file, arrows drawn once where their ends split", () => {
  const dir = fixture("deep");
  const facts = analyze(dir);
  const d = page(facts, Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8"))));
  const b = cutBoard(d, cut(d.nodes, d.paths, "root", Infinity));
  const groups = Object.keys(d.nodes).filter((id) => id !== "root");
  for (const id of groups) assert.ok(b.nodes.includes(id), id);
  assert.equal(b.nodes.filter((x) => x[0] === "@").length, d.paths.filter((_, i) => Object.values(d.nodes).some((n) => n.files.includes(i))).length);
  // containers: a file sits in its leaf, a group in its parent
  for (const id of groups) assert.equal(b.inside![id], d.nodes[id].parent);
  // the code arrows between two siblings sum to what their Default board says
  for (const [id, n] of Object.entries(d.nodes)) {
    for (const e of d.boards[id]?.edges ?? []) {
      if (!n.children.includes(e.a) || !n.children.includes(e.b)) continue;
      const got = b.edges.find((x) => x.a === e.a && x.b === e.b)!;
      assert.deepEqual([got.imports, got.calls], [e.imports, e.calls], `${e.a}>${e.b}`);
      assert.ok(got.major);
    }
  }
  // every arrow joins two boxes in the same container
  for (const e of b.edges) if (!e.uses) assert.equal(b.inside![e.a], b.inside![e.b], `${e.a}>${e.b}`);
});
