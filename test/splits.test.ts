// The Simple stop (#147): named `split`s in the grouping, validated like children, ignored by the
// Default build, guarded like any level, and carried by the page as what differs from Default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Facts, type GroupNode } from "../src/model/schema.ts";
import { simpleStop as shipSimple } from "../src/model/simple.ts";
import { simpleTree, unsplitLeaves } from "../src/model/splits.ts";
import { summarize } from "../src/model/summary.ts";
import type { PageBoard, PageEdge, ViewerData } from "../src/viewer/state.ts";
import { rollStop } from "../src/viewer/stops.ts";
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { lintBoard } from "../src/build/lint.ts";
import { reusedLayout, stopData, stopLayout } from "../src/viewer/stoplayout.ts";
import { stopModel } from "../src/viewer/stopmodel.ts";
import { coarseKids, coarseNodes, fineNodes, treeOf } from "../src/viewer/finetree.ts";
import { unpack } from "../src/viewer/unpack.ts";
import { cut, stopsFor } from "../src/viewer/budget.ts";

const hasSimple = (d: ViewerData) => stopsFor(treeOf(d), d.paths).some((s) => s.key === "simple");

const facts = analyze(fileURLToPath(new URL("./fixtures/deep", import.meta.url)));

const P = (id: string, name: string, files: string[]) => ({ id, name, summary: `${name}.`, files });
const B = (id: string, name: string, members: string[]) => ({ id, name, summary: `${name}.`, members });
const leaf = (id: string, name: string, files: string[], split?: GroupNode["split"]): GroupNode => ({ id, name, summary: `${name}.`, files, ...(split ? { split } : {}) });

/** The deep fixture as two parts: the API, and the app's five areas, with splits where asked. */
function grouping(opts: { buckets?: GroupNode["split"]; pdf?: GroupNode["split"] } = {}): Grouping {
  return Grouping.parse({
    version: 1, summary: "A small billing app.",
    children: [
      leaf("api", "API server", ["src/api/**"]),
      {
        id: "app", name: "Customer app", summary: "What the customer uses.",
        children: [
          leaf("shell", "App shell", ["src/app/shell/**"]),
          leaf("plans", "Plans", ["src/app/billing/plans/**"]),
          leaf("inv-store", "Invoice store", ["src/app/billing/invoices/store/**"]),
          leaf("pdf", "PDF generation", ["src/app/billing/invoices/pdf/**"], opts.pdf),
        ],
        ...(opts.buckets ? { split: opts.buckets } : {}),
      },
    ],
  });
}
const pdfSplit = [P("pdf-layout", "Page layout", ["src/app/billing/invoices/pdf/layout/**"]), P("pdf-render", "Rendering", ["src/app/billing/invoices/pdf/render/**"])];
const appBuckets = [B("app-front", "Front & plans", ["shell", "plans"]), B("app-docs", "Invoices & PDFs", ["inv-store", "pdf"])];

function page(f: Facts, g: Grouping): ViewerData {
  const leafOf = assign(g, f).leafOf;
  const model = buildModel(f, g, leafOf);
  const t = simpleTree(g, f, leafOf);
  if (t) model.simple = shipSimple(f, model, t);
  return pageData(renderHtml(model, {}));
}

/** A board with path indexes turned back into paths, so two pages compare. */
function plain(b: PageBoard, d: ViewerData, withEvidence = true) {
  const id = (x: string) => (x[0] === "@" ? `@${d.paths[Number(x.slice(1))]}` : x);
  const ref = (x: string | number) => (typeof x === "number" ? d.paths[x] : x);
  const edge = (e: PageEdge) => ({ ...e, a: id(e.a), b: id(e.b), ev: withEvidence ? e.ev.map(([f, l, t]) => [ref(f), l, ref(t)]) : [] });
  return { nodes: b.nodes.map(id), context: b.context.map(id), hubs: b.hubs.map(id), throughout: b.throughout, edges: b.edges.map(edge), collections: b.collections };
}

test("schema: a leaf's split lists files, a group's lists members", () => {
  assert.ok(Grouping.safeParse(grouping({ pdf: pdfSplit, buckets: appBuckets })).success);
  const bad = (g: unknown) => !Grouping.safeParse(g).success;
  const base = JSON.parse(JSON.stringify(grouping()));
  base.children[1].split = pdfSplit; // files on a group
  assert.ok(bad(base));
  const one = JSON.parse(JSON.stringify(grouping()));
  one.children[0].split = [P("api-a", "A", ["src/api/**"])]; // one part is no split
  assert.ok(bad(one));
});

test("validation: every file in exactly one part, every child in exactly one bucket, unique ids", () => {
  const errs = (g: Grouping) => assign(g, facts).errors.join("\n");
  assert.equal(errs(grouping({ pdf: pdfSplit, buckets: appBuckets })), "");
  assert.match(errs(grouping({ pdf: [pdfSplit[0], P("pdf-fonts", "Fonts", ["src/app/billing/invoices/pdf/render/fonts.ts"])] })), /split of "pdf": 1 of its file\(s\) in no part: .*render\.ts/);
  assert.match(errs(grouping({ pdf: [...pdfSplit, P("pdf-all", "All", ["src/app/billing/invoices/pdf/layout/**"])] })), /matched equally by two parts/);
  assert.match(errs(grouping({ pdf: [...pdfSplit, P("pdf-api", "Elsewhere", ["src/api/**"])] })), /part "pdf-api" holds none of its files/);
  assert.match(errs(grouping({ buckets: [B("a1", "A", ["shell", "plans"]), B("a2", "B", ["inv-store", "plans"])] })), /"plans" is in two buckets[\s\S]*in no bucket: pdf/);
  assert.match(errs(grouping({ buckets: [B("a1", "A", ["shell", "api"]), B("a2", "B", ["plans", "inv-store", "pdf"])] })), /lists "api", which is not one of its children/);
  assert.match(errs(grouping({ pdf: [P("shell", "Dup", ["src/app/billing/invoices/pdf/layout/**"]), pdfSplit[1]] })), /duplicate id "shell"/);
});

test("Default ignores splits: the same model, byte for byte", () => {
  const plainG = grouping(), split = grouping({ pdf: pdfSplit, buckets: appBuckets });
  const a = buildModel(facts, plainG, assign(plainG, facts).leafOf), b = buildModel(facts, split, assign(split, facts).leafOf);
  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test("no splits: no Simple stop, and the page is unchanged", () => {
  const g = grouping();
  assert.equal(simpleTree(g, facts, assign(g, facts).leafOf), null);
  const d = page(facts, g);
  assert.equal(d.simple, undefined);
  assert.equal(hasSimple(d), false);
  const s = rollStop(d, "simple");
  assert.equal(s.boards, d.boards);
});

test("guardLevels applies: a bucket of one is dropped, the rest of the tree stays as written", () => {
  const g = grouping({ pdf: pdfSplit, buckets: [B("a1", "Shell", ["shell"]), B("a2", "Billing", ["plans", "inv-store", "pdf"])] });
  const t = simpleTree(g, facts, assign(g, facts).leafOf)!;
  assert.deepEqual(t.kept, ["pdf"]);
  assert.deepEqual(t.dropped, [{ id: "app", why: 'bucket "a1" holds one part' }]);
  const app = t.grouping.children[1];
  assert.deepEqual(app.children!.map((c) => c.id), ["shell", "plans", "inv-store", "pdf"]);
  assert.deepEqual(app.children![3].children!.map((c) => [c.id, c.files]), [["pdf-layout", ["src/app/billing/invoices/pdf/layout/page.ts", "src/app/billing/invoices/pdf/layout/table.ts"]], ["pdf-render", ["src/app/billing/invoices/pdf/render/fonts.ts", "src/app/billing/invoices/pdf/render/render.ts"]]]);
});

test("Simple in the page: every board equals a build of the split grouping", () => {
  const g = grouping({ pdf: pdfSplit, buckets: appBuckets });
  const t = simpleTree(g, facts, assign(g, facts).leafOf)!;
  assert.deepEqual(t.kept, ["app", "pdf"]);
  const d = page(facts, g), want = page(facts, t.grouping);
  assert.equal(hasSimple(d), true);
  const s = rollStop(d, "simple");
  assert.deepEqual(Object.keys(s.nodes).sort(), Object.keys(want.nodes).sort());
  for (const [id, n] of Object.entries(want.nodes)) {
    assert.equal(s.nodes[id].parent, n.parent, id);
    assert.deepEqual(s.nodes[id].children, n.children, id);
    assert.equal(s.nodes[id].name, n.name, id);
  }
  assert.deepEqual(Object.keys(s.boards).sort(), Object.keys(want.boards).sort());
  for (const id of Object.keys(want.boards)) assert.deepEqual(plain(s.boards[id], d), plain(want.boards[id], want), id);
  // the page ships only what it can't roll up: the boards drawing new parts or buckets, and the new file boards
  assert.deepEqual(Object.keys(d.simple!.boards).sort(), ["app", "pdf", "pdf-layout", "pdf-render"]);
  // ids: Simple-only ids map back to their Default holder
  assert.deepEqual(s.toDefault, { "app-docs": "app", "app-front": "app", "pdf-layout": "pdf", "pdf-render": "pdf" });
});

test("one tree: splits fold in as fine nodes, which Default skips and Simple shows", async () => {
  const g = grouping({ pdf: pdfSplit, buckets: appBuckets }), d = page(facts, g), t = treeOf(d);
  assert.deepEqual(Object.keys(t).filter((id) => t[id].fine).sort(), ["app-docs", "app-front", "pdf-layout", "pdf-render"]);
  // a split leaf keeps its files and gains its parts; a bucketed group's children sit under its buckets
  assert.deepEqual(t.pdf.files, d.nodes.pdf.files);
  assert.deepEqual(t.pdf.children, ["pdf-layout", "pdf-render"]);
  assert.deepEqual(t.app.children, ["app-front", "app-docs"]);
  assert.equal(t.shell.parent, "app-front");
  // skipping the fine nodes gives Default's tree back exactly
  assert.deepEqual(coarseKids(t, "app"), d.nodes.app.children);
  assert.deepEqual(coarseKids(t, "pdf"), []);
  assert.deepEqual(coarseNodes(t), d.nodes);
  // showing them gives Simple's
  const want = page(facts, simpleTree(g, facts, assign(g, facts).leafOf)!.grouping);
  const f = fineNodes(t);
  assert.deepEqual(Object.keys(f).sort(), Object.keys(want.nodes).sort());
  for (const [id, n] of Object.entries(want.nodes)) assert.deepEqual({ ...f[id], files: f[id].files.map((x) => d.paths[x as number]) }, { ...n, files: n.files.map((x) => want.paths[x as number]) }, id);
  // the unpacked page carries it; without splits the tree is Default's own
  assert.equal((await unpack(d)).tree, t);
  const plainPage = page(facts, grouping());
  assert.equal(treeOf(plainPage), plainPage.nodes);
  // cut() skips the fine nodes: on the tree, every stop above Default draws what Default's tree gives
  for (const board of Object.keys(d.nodes)) for (const b of [0, 30, 75, Infinity]) assert.deepEqual(cut(t, d.paths, board, b), cut(d.nodes, d.paths, board, b), `${board} @${b}`);
});

test("big leaves without a split are listed by the build line and the digest", () => {
  const big = grouping();
  // fake a big leaf: the threshold is files per leaf, so lower the bar by counting pdf's files twice
  const leafOf = new Map(assign(big, facts).leafOf);
  for (let i = 0; i < 4; i++) leafOf.set(`extra${i}.ts`, "pdf");
  assert.deepEqual(unsplitLeaves(big, leafOf), [{ id: "pdf", name: "PDF generation", files: 8 }]);
  assert.deepEqual(unsplitLeaves(grouping({ pdf: pdfSplit }), leafOf), []);
  assert.doesNotMatch(summarize(facts, big), /Leaves to split/);
  assert.doesNotMatch(summarize(facts), /Leaves to split/);
});

test("Simple lays out in the page: new boards by ELK with no hard lint defects, the rest keep Default's", async () => {
  const elk = new (bundled as unknown as new () => ElkApi)();
  const run = (g: ElkNode) => elk.layout(g);
  const g = grouping({ pdf: pdfSplit, buckets: appBuckets });
  const leafOf = assign(g, facts).leafOf, model = buildModel(facts, g, leafOf);
  model.simple = shipSimple(facts, model, simpleTree(g, facts, leafOf)!);
  const d = pageData(renderHtml(model, await layoutBoards(model)));
  const s = stopData(d, "simple"), sm = stopModel(d, s);
  const toModel = (id: string) => (id[0] === "@" ? `f:${d.paths[Number(id.slice(1))]}` : id);
  const elked: string[] = [];
  for (const id of Object.keys(s.boards).sort()) {
    const b = s.boards[id], reused = reusedLayout(d, "simple", id), l = await stopLayout(d, "simple", id, run);
    if (reused) { assert.equal(l, d.layout[id], `${id}: the Default layout`); continue; }
    elked.push(id);
    assert.deepEqual(l.n.map((n) => n[0]).sort(), [...b.nodes].sort(), `${id}: every box once`);
    assert.deepEqual(l.e.map((e) => `${e[0]}>${e[1]}`).sort(), b.edges.filter((e) => e.major).map((e) => `${e.a}>${e.b}`).sort(), `${id}: every drawn arrow`);
    const ml = { n: l.n.map(([x, ...r]) => [toModel(x), ...r]), e: l.e.map(([a, z, ...r]) => [toModel(a), toModel(z), ...r]) } as BoardLayout;
    assert.deepEqual(lintBoard(sm.model, id, ml).defects, [], `${id}: no hard lint defects`);
  }
  // the split boards and the boards under the bucket level are new; the root's stays as built
  for (const id of ["app", "app-docs", "app-front", "pdf", "pdf-layout", "pdf-render"]) assert.ok(elked.includes(id), `${id} in ${elked.join(" ")}`);
  assert.ok(!elked.includes("root"));
});
