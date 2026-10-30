// composeTour and findChains (#193, docs/tours-v2.md, docs/tours-data.md): a file chain becomes a
// multi-depth tour, every step on a board that draws it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { fileGraph } from "../src/model/fgraph.ts";
import { Grouping } from "../src/model/schema.ts";
import { ChainError, composeTour, findChains, type TourGraph, type TourStep } from "../src/model/compose.ts";
import { cut, extraBoxes, stopsFor } from "../src/viewer/budget.ts";
import { cutBoard } from "../src/viewer/cutboard.ts";
import type { ViewerData } from "../src/viewer/state.ts";

const page = (name: string): ViewerData => {
  const dir = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const g = Grouping.parse(JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8")));
  const f = analyze(dir);
  const leafOf = assign(g, f).leafOf;
  const model = buildModel(f, g, leafOf);
  model.fgraph = fileGraph(f, leafOf);
  return pageData(renderHtml(model, {}));
};
const deep = page("deep");
const clinic = page("checkin");

const P = {
  server: "src/api/server.ts", main: "src/app/shell/main.ts", plans: "src/app/billing/plans/plans.ts",
  store: "src/app/billing/invoices/store/invoiceStore.ts", page: "src/app/billing/invoices/pdf/layout/page.ts",
  table: "src/app/billing/invoices/pdf/layout/table.ts", render: "src/app/billing/invoices/pdf/render/render.ts",
};
const K = {
  kiosk: "web/src/pages/KioskPage.tsx", http: "web/src/utils/kioskHttp.ts", fn: "functions/src/checkin/checkin.ts",
  forms: "functions/src/forms/forms.ts", accounts: "functions/src/accounts/accounts.ts", screen: "web/src/components/NameScreen.tsx",
};
const level = (d: ViewerData, id: string) => { let n = 0; for (let p = d.nodes[id]?.parent; p; p = d.nodes[p].parent) n++; return n; };
const at = (d: ViewerData, s: TourStep) => `${s.board}@${s.stop} ${s.lit.edges.map(([a, b]) => `${a}>${b}`).join(",")}`;
const ix = (d: ViewerData, p: string) => `@${d.paths.indexOf(p)}`;

/** Every lit edge is one the step's board draws (or lists) at its stop; every lit box is on it. */
function assertDrawn(d: ViewerData, s: TourStep) {
  if (s.stop === "default") {
    const b = d.boards[s.board];
    for (const x of s.lit.boxes) assert.ok(b.nodes.includes(x), `${x} is on ${s.board}`);
    for (const [x, y] of s.lit.edges) assert.ok(b.edges.some((e) => e.a === x && e.b === y), `${x} -> ${y} on ${s.board}`);
    return;
  }
  const def = stopsFor(d.nodes, d.paths).find((x) => x.key === s.stop);
  assert.ok(def, `${s.stop} is a stop of this repo`);
  // the boxes are drawn by the cut at that stop: closed boxes, or containers
  const c = cut(d.nodes, d.paths, s.board, def.budget, { extra: extraBoxes(d.nodes, d.boards[s.board], s.board) });
  const any = s.lit.boxes.every((x) => c.boxes.includes(x) || x in c.open);
  // and the arrow is one the cut's board draws (viewer/cutboard.ts)
  const drawnEdges = cutBoard(d, c).edges;
  for (const [x, y] of s.lit.edges) assert.ok(drawnEdges.some((e) => e.a === x && e.b === y), `${x} -> ${y} on ${s.board} at ${s.stop}`);
  assert.ok(any, `${s.lit.boxes} drawn on ${s.board} at ${s.stop}`);
}

test("compose: each hop lands on its lowest common ancestor's board (deep fixture)", () => {
  const steps = composeTour(deep, [P.main, P.store, P.render, P.page, P.table]);
  assert.deepEqual(steps.map((s) => at(deep, s)), [
    "app@default shell>billing",
    "invoices@default inv-store>pdf",
    "pdf@default pdf-render>pdf-layout",
    `pdf-layout@default ${ix(deep, P.page)}>${ix(deep, P.table)}`,
  ]);
  assert.deepEqual(steps.map((s) => s.via), [[P.main, P.store], [P.store, P.render], [P.render, P.page], [P.page, P.table]]);
  for (const s of steps) assertDrawn(deep, s);
  assert.equal(steps[0].caption, `App shell → Billing & payments: main.ts imports invoiceStore.ts (${P.main}:2)`);
  assert.equal(steps[3].caption, `page.ts imports table.ts (${P.page}:1)`);
});

test("compose: a call hop is captioned with its endpoint; a sink ends the chain", () => {
  const steps = composeTour(deep, [P.main, P.server, P.plans, "svc-stripe"]);
  assert.deepEqual(steps.map((s) => at(deep, s)), [
    "root@default app>api",
    "root@default api>app",
    `plans@default ${ix(deep, P.plans)}>svc-stripe`,
  ]);
  assert.match(steps[0].caption, /main\.ts calls \/plans in server\.ts \(src\/app\/shell\/main\.ts:6\)/);
  assert.match(steps[2].caption, /plans\.ts uses Stripe: stripe/);
  for (const s of steps) assertDrawn(deep, s);
});

test("compose: depth caps how far down a step goes, opening the board to a higher stop", () => {
  const chain = [P.main, P.store, P.render, P.page, P.table];
  // the chain's top board is `app`: depth 1 keeps every step on app or its children's boards
  const steps = composeTour(deep, chain, { depth: 1 });
  for (const s of steps) assert.ok(level(deep, s.board) <= 2, at(deep, s));
  assert.equal(steps[0].stop, "default");
  assert.ok(steps.slice(1).every((s) => s.board === "billing" && s.stop !== "default"), steps.map((s) => at(deep, s)).join(" | "));
  for (const s of steps) assertDrawn(deep, s);
  // depth 0: everything on the top board
  const flat = composeTour(deep, chain, { depth: 0 });
  assert.ok(flat.every((s) => s.board === "app"));
  assert.equal(flat[3].lit.edges[0].join(">"), `${ix(deep, P.page)}>${ix(deep, P.table)}`);
  for (const s of flat) assertDrawn(deep, s);
});

test("compose: captions from the caller win, one per hop", () => {
  const steps = composeTour(deep, [P.main, P.store, P.render], { captions: ["The shell asks the store.", undefined] });
  assert.equal(steps[0].caption, "The shell asks the store.");
  assert.match(steps[1].caption, /invoiceStore\.ts imports render\.ts/);
});

test("compose: a missing edge is rejected, naming the hop and whether it runs the other way", () => {
  assert.throws(() => composeTour(deep, [P.main, P.store, P.main]), (e: unknown) => {
    assert.ok(e instanceof ChainError);
    assert.deepEqual(e.hop, [P.store, P.main]);
    assert.equal(e.reversed, true);
    assert.match(e.message, /hop 2: there is no edge .*invoiceStore\.ts -> .*main\.ts \(there is one/);
    return true;
  });
  assert.throws(() => composeTour(deep, [P.table, P.render]), (e: unknown) => e instanceof ChainError && e.reversed === false && /hop 1/.test(e.message));
  assert.throws(() => composeTour(deep, [P.main, "src/nope.ts"]), (e: unknown) => e instanceof ChainError && /"src\/nope\.ts" is not a file/.test(e.message));
  assert.throws(() => composeTour(deep, [P.main, "svc-stripe"]), (e: unknown) => e instanceof ChainError && /does not use svc-stripe/.test(e.message));
  assert.throws(() => composeTour(deep, [P.main]), ChainError);
});

test("compose: a large app's check-in goes down, up across the backend call, and down again", () => {
  const steps = composeTour(clinic, [K.kiosk, K.http, K.fn, K.forms, "store-firestore"]);
  assert.deepEqual(steps.map((s) => at(clinic, s)), [
    "web-checkin@default checkin-pages>checkin-http",
    "root@default web>functions",
    // fn-checkin -> fn-forms is only listed on functions at Default, so the hop opens a higher stop that draws it
    "functions@everything fn-checkin>fn-forms",
    `fn-forms@default ${ix(clinic, K.forms)}>store-firestore`,
  ]);
  // the rhythm: in a part, up to where both ends show, then back down
  assert.deepEqual(steps.map((s) => level(clinic, s.board)), [2, 0, 1, 2]);
  assert.match(steps[1].caption, /^Web app → Cloud backend: kioskHttp\.ts calls checkIn in checkin\.ts \(web\/src\/utils\/kioskHttp\.ts:4\)$/);
  assert.match(steps[3].caption, /forms\.ts uses Firestore: Forms \(read\)/);
  for (const s of steps) assertDrawn(clinic, s);
});

test("compose: a hop is placed where it is drawn as an arrow; a listed-only hop falls back and is reported", () => {
  const chain = [K.kiosk, K.http, K.fn, K.forms, "store-firestore"];
  const fell: { hop: [string, string]; board: string }[] = [];
  let none = 0;
  composeTour(clinic, chain, { onFallback: () => none++ });
  assert.equal(none, 0, "every hop of the shipped data is drawn");
  // the same page with every board edge only listed: the sink hop has no stop to climb, so it falls back
  const minor = (d: TourGraph): TourGraph => ({ ...d, boards: Object.fromEntries(Object.entries(d.boards).map(([id, b]) => [id, { ...b, edges: b.edges.map((e) => ({ ...e, major: false })) }])) });
  const listed = minor(clinic as TourGraph);
  const got = composeTour(listed, chain, { onFallback: (i) => fell.push(i) });
  assert.deepEqual(fell.map((f) => f.hop), [[K.forms, "store-firestore"]]);
  assert.equal(fell[0].board, "fn-forms");
  assert.equal(got.at(-1)!.board, "fn-forms");
  assert.equal(got.length, chain.length - 1, "no hop is dropped");
});

test("compose: author depth never moves a hop off a board that draws it", () => {
  const chain = [K.kiosk, K.http, K.fn, K.forms, "store-firestore"];
  for (const depth of [0, 1]) for (const s of composeTour(clinic, chain, { depth })) assertDrawn(clinic, s);
});

test("compose: the tour reads the page data as shipped, and is deterministic", () => {
  const a = composeTour(clinic, [K.kiosk, K.http, K.fn, K.accounts]);
  const b = composeTour(page("checkin"), [K.kiosk, K.http, K.fn, K.accounts]);
  assert.deepEqual(a, b);
  // a TourGraph is only the tree, paths, boards and fgraph
  const g: TourGraph = { paths: clinic.paths, nodes: clinic.nodes, boards: clinic.boards, fgraph: clinic.fgraph, services: clinic.services };
  assert.deepEqual(composeTour(g, [K.kiosk, K.http, K.fn, K.accounts]), a);
});

test("findChains: from a page to a store, shortest first, each one composable", () => {
  const chains = findChains(clinic, K.kiosk, "store-firestore");
  assert.deepEqual(chains[0], [K.kiosk, K.http, K.fn, K.accounts, "store-firestore"]);
  assert.deepEqual(chains[1], [K.kiosk, K.http, K.fn, K.forms, "store-firestore"]);
  for (const c of chains) assert.ok(composeTour(clinic, c).length === c.length - 1);
  // any sink when `to` is omitted
  assert.deepEqual(findChains(clinic, K.kiosk)[0].at(-1), "store-firestore");
});

test("findChains: between groups, bounded by maxLen and max", () => {
  const chains = findChains(clinic, "web-checkin", "fn-forms");
  assert.ok(chains.length >= 2);
  for (const c of chains) {
    assert.ok(clinic.nodes["web-checkin"].children.some((k) => clinic.nodes[k].files.map((f) => clinic.paths[f as number]).includes(c[0])));
    assert.equal(c.at(-1), K.forms);
    assert.ok(composeTour(clinic, c).length);
  }
  for (let i = 1; i < chains.length; i++) assert.ok(chains[i - 1].length <= chains[i].length);
  assert.deepEqual(findChains(clinic, K.kiosk, K.forms, { maxLen: 2 }), []);
  assert.equal(findChains(clinic, "web", "functions", { max: 1 }).length, 1);
  assert.deepEqual(findChains(clinic, K.forms, K.kiosk), []);
  // never a chain that starts inside its target
  assert.ok(findChains(clinic, "functions", "functions").length === 0);
  assert.deepEqual(findChains(deep, P.render, P.table), [[P.render, P.page, P.table]]);
});
