import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { resolveTours } from "../src/model/tours.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { chainSection } from "../src/model/chaindigest.ts";
import { summarize } from "../src/model/summary.ts";

const dir = fileURLToPath(new URL("./fixtures/deep", import.meta.url));
const facts = analyze(dir);
const base = JSON.parse(readFileSync(`${dir}/grouping.json`, "utf8"));
const P = "src/app/billing/invoices/";
const MAIN = "src/app/shell/main.ts", SERVER = "src/api/server.ts", STORE = `${P}store/invoiceStore.ts`;
const RENDER = `${P}pdf/render/render.ts`, PAGE = `${P}pdf/layout/page.ts`, TABLE = `${P}pdf/layout/table.ts`;

const run = (tours: unknown[]) => {
  const g = Grouping.parse({ ...base, tours });
  const a = assign(g, facts);
  const model = buildModel(facts, g, a.leafOf);
  return { model, ...resolveTours(g, model) };
};

test("chain tours: each hop plays on the deepest board holding both files, down to a file board", () => {
  const captions = ["The app calls the API.", "The API loads the invoice.", "The store renders it.", "The renderer lays out a page.", "The page draws its tables."];
  const { tours, errors } = run([{ title: "Downloading an invoice", chain: [MAIN, SERVER, STORE, RENDER, PAGE, TABLE], captions }]);
  assert.deepEqual(errors, []);
  const t = tours[0];
  assert.equal(t.id, "downloading-an-invoice");
  assert.equal(t.source, "claude");
  assert.deepEqual(t.steps.map((s) => s.board), ["root", "root", "invoices", "pdf", "pdf-layout"]);
  assert.deepEqual(t.steps.map((s) => s.edge), [["app", "api"], ["api", "app"], ["inv-store", "pdf"], ["pdf-render", "pdf-layout"], [`f:${PAGE}`, `f:${TABLE}`]]);
  assert.deepEqual(t.steps.map((s) => s.text), captions);
  assert.deepEqual(t.steps[0].via, [MAIN, SERVER]);
  assert.equal(t.steps[0].stop, "default");
});

test("chain tours: the old steps form still validates next to a chain", () => {
  const { tours, errors } = run([...base.tours, { id: "render", title: "Rendering", chain: [RENDER, PAGE] }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(tours.map((t) => t.id), ["download", "render"]);
  // no captions: composeTour writes one from the evidence
  assert.match(tours[1].steps[0].text, /render\.ts imports page\.ts \(src\/app\/billing\/invoices\/pdf\/render\/render\.ts:\d+\)$/);
});

test("chain tours: a chain may end in a service the last file uses", () => {
  const { tours, errors } = run([{ title: "Plans", chain: [SERVER, "src/app/billing/plans/plans.ts", "svc-stripe"] }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(tours[0].steps.at(-1)!.via, ["src/app/billing/plans/plans.ts", "svc-stripe"]);
  assert.equal(tours[0].steps.at(-1)!.edge![1], "svc-stripe");
});

test("chain tours: a hop no board draws as an arrow still builds, with a warning naming the tour, hop and board", () => {
  const chain = [SERVER, "src/app/billing/plans/plans.ts", "svc-stripe"];
  const g = Grouping.parse({ ...base, tours: [{ title: "Plans", chain }] });
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  const ok = resolveTours(g, model);
  assert.deepEqual([ok.errors, ok.warnings], [[], []], "drawn on the shipped model");
  for (const b of Object.values(model.boards)) for (const e of b.edges) e.major = false;
  const r = resolveTours(g, model);
  assert.deepEqual(r.errors, []);
  assert.equal(r.tours[0].steps.length, 2, "no hop is dropped");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^tours\[0\] "plans": hop 2: src\/app\/billing\/plans\/plans\.ts -> svc-stripe is listed on board "[^"]+" but no board draws it as an arrow/);
});

test("chain tours: INVALID messages name the hop, the reversed edge, unknown files and caption counts", () => {
  const err = (t: unknown) => run([t]).errors.join("\n");
  assert.match(err({ title: "T", chain: [STORE, SERVER] }), /tours\[0\] "t": hop 1: no import or call .*invoiceStore\.ts -> src\/api\/server\.ts \(there is one src\/api\/server\.ts -> .*invoiceStore\.ts;/);
  assert.match(err({ title: "T", chain: [MAIN, TABLE] }), /hop 1: no import or call src\/app\/shell\/main\.ts -> .*table\.ts$/);
  assert.match(err({ title: "T", chain: [MAIN, "src/server.ts"] }), /chain\[1\] "src\/server\.ts" is not a source file on any board .*did you mean "src\/api\/server\.ts"\?/);
  assert.match(err({ title: "T", chain: [MAIN, SERVER], captions: ["a", "b"] }), /2 captions for 1 hop/);
  assert.match(err({ title: "T", chain: [MAIN, SERVER, "svc-stripe"] }), /hop 2: src\/api\/server\.ts does not use svc-stripe/);
  assert.match(err({ title: "T", chain: ["svc-stripe", MAIN] }), /chain\[0\] "svc-stripe" is not a source file on any board \(a service or store may only end a chain\)/);
  assert.match(run([{ title: "T", chain: [MAIN, SERVER] }, { title: "T", chain: [RENDER, PAGE] }]).errors.join("\n"), /duplicate tour id "t" \(from its title/);
  assert.ok(!Grouping.safeParse({ ...base, tours: [{ title: "T", chain: [MAIN] }] }).success);
});

test("chain tours: file boxes become page ids in the page data", () => {
  const { model, tours } = run([{ id: "pg", title: "Pages", chain: [PAGE, TABLE] }]);
  model.tours = tours;
  const data = pageData(renderHtml(model, {} as Parameters<typeof renderHtml>[1]));
  const s = data.tours![0].steps[0];
  const at = (f: string) => `@${data.paths.indexOf(f)}`;
  assert.deepEqual(s.edge, [at(PAGE), at(TABLE)]);
  assert.deepEqual(s.lit, { boxes: [at(PAGE), at(TABLE)], edges: [[at(PAGE), at(TABLE)]] });
});

test("digest: runtime chains start at entries, prefer a call into a store, and never pass through another page", () => {
  const imp = (from: string, to: string) => ({ from, to, line: 1, kind: "static" });
  const facts = {
    packages: [{ id: "web", kind: "web" }, { id: "fn", kind: "backend" }],
    files: ["web/src/pages/A.tsx", "web/src/pages/B.tsx", "web/src/routes.ts", "web/src/api.ts", "fn/src/checkin.ts", "fn/src/forms.ts"].map((path) => ({ path, pkg: path.split("/")[0] })),
    pages: [{ route: "/a", file: "web/src/pages/A.tsx" }, { route: "/b", file: "web/src/pages/B.tsx" }],
    endpoints: [{ name: "checkin", file: "fn/src/checkin.ts", kind: "callable" }],
    imports: [imp("web/src/pages/A.tsx", "web/src/routes.ts"), imp("web/src/routes.ts", "web/src/pages/B.tsx"), imp("web/src/pages/B.tsx", "web/src/api.ts"), imp("fn/src/checkin.ts", "fn/src/forms.ts")],
    calls: [{ from: "web/src/api.ts", to: "fn/src/checkin.ts", endpoint: "checkin", line: 3 }],
    services: [], serviceUses: [],
    stores: [{ id: "firestore", name: "Firestore" }],
    storeUses: [{ store: "firestore", collection: "Forms", op: "write", file: "fn/src/forms.ts", line: 2 }],
  } as unknown as Parameters<typeof chainSection>[0];
  const lines = chainSection(facts, 10, 5).join("\n");
  assert.match(lines, /^- web\/src\/pages\/B\.tsx → web\/src\/api\.ts ⇒ fn\/src\/checkin\.ts → fn\/src\/forms\.ts {2}\[store-firestore: Forms \(w\)\]$/m);
  // A reaches B only through the router, so it has no chain of its own
  assert.doesNotMatch(lines, /^- web\/src\/pages\/A\.tsx/m);
  assert.match(lines, /^Entry files \(pages, endpoint files, app entries\): fn\/src\/checkin\.ts, web\/src\/pages\/A\.tsx, web\/src\/pages\/B\.tsx$/m);
});

test("digest: a type-only import is neither a chain hop nor a next hop", () => {
  const imp = (from: string, to: string, kind = "static") => ({ from, to, line: 1, kind });
  // the ai-chatbot shape: actions.ts → queries.ts, and queries.ts only imports a type from artifact.tsx
  const facts = {
    packages: [{ id: "app", kind: "web" }],
    files: ["app/actions.ts", "lib/queries.ts", "components/artifact.tsx", "lib/db.ts"].map((path) => ({ path, pkg: "app" })),
    pages: [], endpoints: [{ name: "save", file: "app/actions.ts", kind: "action" }],
    imports: [imp("app/actions.ts", "lib/queries.ts"), imp("lib/queries.ts", "components/artifact.tsx", "type"), imp("components/artifact.tsx", "lib/db.ts")],
    calls: [], stores: [], storeUses: [],
    services: [{ id: "postgres", name: "PostgreSQL" }],
    serviceUses: [{ from: "lib/db.ts", service: "postgres", spec: "pg", line: 1 }],
  } as unknown as Parameters<typeof chainSection>[0];
  const lines = chainSection(facts, 10, 5, 10).join("\n");
  assert.doesNotMatch(lines, /queries\.ts → components\/artifact\.tsx/);
  assert.doesNotMatch(lines, /^  lib\/queries\.ts → /m);
  // with the import a real one, the same chain is found
  (facts.imports[1] as { kind: string }).kind = "static";
  assert.match(chainSection(facts, 10, 5).join("\n"), /^- app\/actions\.ts → lib\/queries\.ts → components\/artifact\.tsx → lib\/db\.ts {2}\[svc-postgres\]$/m);
});

test("digest: the summary carries the chain section", () => {
  const basic = analyze(fileURLToPath(new URL("./fixtures/basic-app", import.meta.url)));
  assert.match(summarize(basic), /## Runtime chains[^\n]*\n[^\n]*\n[^\n]*\n- src\/main\.tsx → src\/pages\/Home\.tsx → src\/components\/Button\.tsx → src\/lib\/cart\.ts {2}\[svc-stripe\]/);
});
