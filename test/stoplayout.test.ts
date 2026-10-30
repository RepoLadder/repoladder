// The detail dial's stops laid out in the page (viewer/stoplayout.ts, #144), run here with elkjs in
// Node in place of the page's Worker: every box and drawn arrow placed, no hard lint defects, and
// boards a stop draws as Default keep their Default (D2) layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { everyDefects } from "../src/build/everylint.ts";
import { buildViewer } from "../src/build/viewer.ts";
import { elkCandidates } from "../src/build/engines/elkboard.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Facts } from "../src/model/schema.ts";
import type { ViewerData } from "../src/viewer/state.ts";
import { ELK_URL } from "../src/viewer/elkload.ts";
import { cutLayout, stopData } from "../src/viewer/stoplayout.ts";
import { cut } from "../src/viewer/budget.ts";
import { everyGraphs, nameSize } from "../src/viewer/everylayout.ts";
import { stopModel } from "../src/viewer/stopmodel.ts";

const elk = new (bundled as unknown as new () => ElkApi)();
const run = (g: ElkNode) => elk.layout(g);
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const everything = (d: ViewerData) => cut(d.nodes, d.paths, "root", Infinity);
const deepGrouping = () => Grouping.parse(JSON.parse(readFileSync(`${fixture("deep")}/grouping.json`, "utf8")));

async function page(facts: Facts, g: Grouping): Promise<ViewerData> {
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  return pageData(renderHtml(model, await layoutBoards(model)));
}

test("lane boxes take ELK partitions: senders before the parts, receivers after", async () => {
  const facts = analyze(fixture("deep"));
  const d = await page(facts, deepGrouping());
  const s = stopData(d, "simple"), { model } = stopModel(d, s);
  for (const id of Object.keys(s.boards)) {
    const c = elkCandidates(model, id)[0];
    if (!c?.graph.part) continue;
    for (const e of c.graph.edges) assert.ok((c.graph.part[e.a] ?? 1) <= (c.graph.part[e.b] ?? 1), `${id}: ${e.a}>${e.b} runs forward`);
  }
});

test("Everything: every box inside its container, siblings apart, every arrow routed", async () => {
  const facts = analyze(fixture("deep"));
  const d = await page(facts, deepGrouping());
  const { board: b, laid } = cutLayout(d, everything(d), run), l = await laid;
  const at = new Map(l.n.map((n) => [n[0], n]));
  assert.deepEqual([...at.keys()].sort(), [...b.nodes].sort());
  // containers come before what they hold, so drawing in order paints them underneath
  const order = new Map(l.n.map((n, i) => [n[0], i]));
  for (const [id, c] of Object.entries(b.inside!)) {
    if (c === "root") continue;
    const [, x, y, w, h] = at.get(id)!, [, cx, cy, cw, ch] = at.get(c)!;
    assert.ok(x >= cx && y >= cy && x + w <= cx + cw && y + h <= cy + ch, `${id} inside ${c}`);
    assert.ok(order.get(c)! < order.get(id)!, `${c} drawn before ${id}`);
  }
  const ids = [...at.keys()];
  for (const p of ids) for (const q of ids) {
    if (p >= q || (b.inside![p] ?? "root") !== (b.inside![q] ?? "root")) continue;
    const [, x1, y1, w1, h1] = at.get(p)!, [, x2, y2, w2, h2] = at.get(q)!;
    assert.ok(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1, `${p} and ${q} overlap`);
  }
  assert.deepEqual(l.e.map((e) => `${e[0]}>${e[1]}`).sort(), b.edges.map((e) => `${e.a}>${e.b}`).sort());
  assert.deepEqual(everyDefects(b, l), [], "no hard lint defects");
});

test("Everything packs the groups: containers of containers by rectpacking, a leaf's files layered", async () => {
  const facts = analyze(fixture("deep"));
  const d = await page(facts, deepGrouping());
  const b = cutLayout(d, everything(d), run).board;
  const [g] = everyGraphs(d, d.nodes, b);
  const algo = (n: ElkNode): string[] => [String(n.layoutOptions?.["elk.algorithm"] ?? ""), ...(n.children ?? []).flatMap(algo)].filter(Boolean);
  assert.equal(g.layoutOptions?.["elk.algorithm"], "rectpacking", "the root is packed");
  assert.ok(algo(g).includes("layered"), "a leaf's files are layered");
  // the top level's names read bigger than the next level's, like a map's
  assert.ok(nameSize(b, 1) > nameSize(b, 2) && nameSize(b, 2) >= nameSize(b, 3));
});

test("Everything on every fixture's default grouping (no-AI builds): every box placed, no defects", async () => {
  for (const name of ["basic-app", "multi", "stores", "servers", "deep"]) {
    const facts = analyze(fixture(name));
    const d = await page(facts, defaultGrouping(facts));
    const { board: b, laid } = cutLayout(d, everything(d), run), l = await laid;
    assert.deepEqual(l.n.map((n) => n[0]).sort(), [...b.nodes].sort(), `${name}: every box`);
    assert.equal(l.e.length, b.edges.length, `${name}: every arrow`);
    assert.deepEqual(everyDefects(b, l), [], `${name}: no hard lint defects`);
  }
});

test("elkjs is loaded only on demand, from a pinned jsdelivr file, and never bundled into the page", () => {
  assert.match(ELK_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/elkjs@\d+\.\d+\.\d+\/lib\/elk-worker\.min\.js$/);
  const { js } = buildViewer();
  assert.ok(!js.includes("gwtOnLoad"), "no elkjs code in the viewer bundle");
  assert.ok(js.includes(ELK_URL), "the viewer names the pinned file");
  assert.match(readFileSync(new URL("../src/viewer/elkload.ts", import.meta.url), "utf8"), /algorithms: \[[^\]]*"rectpacking"/, "the Worker sets up rectpacking (Everything packs with it)");
});
