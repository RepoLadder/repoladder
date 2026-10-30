// The viewer at any depth (#104): a 5-level fixture, the collapsing breadcrumbs, the depth readout,
// and deep links, tours and the zoom transition across several levels at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { buildViewer } from "../src/build/viewer.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { resolveTours } from "../src/model/tours.ts";
import { collapse, hidden, trailIds } from "../src/viewer/crumbs.ts";
import { hashFor, parseHash } from "../src/viewer/deeplink.ts";
import { MIN_LEVELS, depthView, gauge, levelsDown } from "../src/viewer/depthbadge.ts";
import { st, type ViewerData } from "../src/viewer/state.ts";
import { plan } from "../src/viewer/transition.ts";

const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));

async function deep(): Promise<ViewerData> {
  const facts = analyze(dir);
  const grouping = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
  const a = assign(grouping, facts);
  assert.deepEqual(a.errors, []);
  const model = buildModel(facts, grouping, a.leafOf);
  const tours = resolveTours(grouping, model);
  assert.deepEqual(tours.errors, []);
  model.tours = tours.tours;
  return pageData(renderHtml(model, await layoutBoards(model)));
}

const data = await deep();
st.data = data;

test("the deep fixture is five rungs below the overview, with a board at every rung", () => {
  const depth = (id: string) => trailIds(id).length - 1;
  assert.equal(Math.max(...Object.keys(data.layout).map(depth)), 5);
  assert.deepEqual(trailIds("pdf-render"), ["root", "app", "billing", "invoices", "pdf", "pdf-render"]);
  for (const id of ["root", "app", "billing", "invoices", "pdf", "pdf-render"]) assert.ok(data.layout[id], id);
});

test("every board and box at every depth deep-links and reads back", () => {
  for (const board of Object.keys(data.layout)) {
    const hits = [null, ...data.layout[board].n.map((n) => `n:${n[0]}`)];
    for (const hit of hits) {
      const h = hashFor(data, board, hit);
      assert.deepEqual(parseHash(data, `#${h}`) ?? { board: "root", hit: null }, { board, hit }, `#${h}`);
    }
  }
});

test("a tour steps from the top to four rungs down and back", () => {
  assert.deepEqual(data.tours?.[0].steps.map((s) => s.board), ["app", "pdf", "root"]);
});

test("the zoom transition plans a multi-rung jump through the box one rung down", () => {
  const parent = (id: string) => { const p = data.nodes[id]?.parent; return p ?? null; };
  assert.deepEqual(plan("root", "pdf-render", parent), { kind: "in", via: "app" });
  assert.deepEqual(plan("pdf-render", "root", parent), { kind: "out", via: "app" });
  assert.deepEqual(plan("billing", "pdf", parent), { kind: "in", via: "invoices" });
  assert.deepEqual(plan("pdf-render", "billing", parent), { kind: "out", via: "invoices" });
  // across branches at depth it crossfades
  assert.deepEqual(plan("pdf-render", "plans", parent), { kind: "fade" });
});

test("breadcrumbs collapse the middle, keeping home, the board you're on and as many parents as fit; home goes last", () => {
  const widths = [8, 12, 18, 8, 14, 16]; // Overview, Customer app, Billing & payments, Invoices, PDF generation, Rendering engine
  const room = (w: number) => (p: number[]) => p.reduce((s, i) => s + (i < 0 ? 3 : widths[i]) + 2, 0) <= w;
  assert.deepEqual(collapse(6, room(200)), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(collapse(6, room(65)), [0, -1, 3, 4, 5]);
  assert.deepEqual(collapse(6, room(50)), [0, -1, 4, 5]);
  assert.deepEqual(collapse(6, room(36)), [0, -1, 5]);
  assert.deepEqual(collapse(6, room(10)), [-1, 5]);
  assert.deepEqual(hidden(6, [0, -1, 4, 5]), [1, 2, 3]);
  assert.deepEqual(hidden(6, [-1, 5]), [0, 1, 2, 3, 4]);
  // two crumbs never collapse
  assert.deepEqual(collapse(2, () => false), [0, 1]);
});

test("depth reads as plain text by default, on a phone too, and only on deep diagrams", () => {
  assert.equal(levelsDown(0), "Overview");
  assert.equal(levelsDown(1), "1 rung down");
  assert.equal(levelsDown(2), "2 rungs down");
  assert.equal(levelsDown(3), "3 rungs down");
  assert.equal(depthView(3, 2, "auto"), null, "a shallow diagram says it in the crumbs");
  assert.equal(MIN_LEVELS, 4);
  assert.equal(depthView(0, 5, "auto"), null, "nothing on the overview");
  const v = depthView(3, 5, "auto")!;
  assert.equal(v.text, "3 rungs down");
  assert.equal(v.say, "3 rungs down of 5");
  assert.equal(v.gauge, null, "the words, not the gauge, at any width");
  assert.equal(depthView(3, 5, "text")!.gauge, null);
  assert.equal(depthView(3, 5, "gauge")!.gauge, gauge(3, 5));
  assert.equal(depthView(3, 5, "gauge")!.text, null);
  assert.equal(depthView(3, 5, "off"), null);
  // one step per level, the path above lit, the board you're on marked
  const g = gauge(2, 4);
  assert.equal(g.match(/<i /g)!.length, 5);
  assert.equal(g.match(/class="up"/g)!.length, 2);
  assert.equal(g.match(/class="at"/g)!.length, 1);
});

test("the viewer bundle carries the crumb menu and the depth readout", () => {
  const { js, css } = buildViewer();
  assert.ok(js.includes("crumbmenu") && js.includes("repoladder.depth"));
  assert.ok(css.includes(".crumbmenu") && css.includes(".gauge"));
});
