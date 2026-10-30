// Re-exports (#256): named imports go through a re-exporting file (a pure barrel or a package
// index with code of its own) to the file that defines each name, and a route's re-exports
// (`export { action } from "./editor.server"`) are edges, so tours can walk them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Facts } from "../src/model/schema.ts";
import { resolveTours } from "../src/model/tours.ts";

const dir = fileURLToPath(new URL("./fixtures/reexports", import.meta.url));
const facts = analyze(dir);
const edges = (f: Facts) => f.imports.map((i) => `${i.from} -> ${i.to} [${i.kind}${i.via ? ` via ${i.via}` : ""}${i.runtime ? " runtime" : ""}]`);

test("named imports reach the defining file through a package index with code of its own", () => {
  const e = edges(facts).filter((x) => x.startsWith("src/app.ts") || x.startsWith("src/routes/notes") || x.startsWith("src/routes/+shared"));
  assert.deepEqual(e, [
    // `render` is `draw` renamed; `square` comes through two `export *`s; `own` is the index's own
    "src/app.ts -> src/lib/draw.ts [static via src/lib/index.ts]",
    "src/app.ts -> src/lib/index.ts [static]",
    "src/app.ts -> src/lib/make.ts [static via src/lib/index.ts]",
    "src/app.ts -> src/lib/more.ts [static via src/lib/index.ts]",
    "src/app.ts -> src/lib/shapes.ts [static via src/lib/index.ts]",
    // a namespace import can't be traced, so it stays on the index
    "src/app.ts -> src/lib/index.ts [static]",
    "src/routes/+shared/editor.server.ts -> src/lib/more.ts [static via src/lib/index.ts]",
    "src/routes/notes.new.tsx -> src/lib/make.ts [static via src/lib/index.ts]",
    "src/routes/notes.new.tsx -> src/routes/+shared/editor.server.ts [reexport runtime]",
  ]);
});

test("a route's re-exports run; a barrel's pass names through only to importers routed past it", () => {
  const e = edges(facts).filter((x) => x.includes("[reexport"));
  assert.deepEqual(e, [
    // imported by app.ts and the routes: its importers were routed past it
    "src/lib/index.ts -> src/lib/make.ts [reexport]",
    "src/lib/index.ts -> src/lib/draw.ts [reexport]",
    "src/lib/index.ts -> src/lib/shapes.ts [reexport]",
    "src/lib/shapes.ts -> src/lib/more.ts [reexport]",
    // nothing imports it, but it re-exports a route module's `loader`
    "src/routes/cache.tsx -> src/routes/cache.server.ts [reexport runtime]",
    // nothing imports it, with code of its own: a route
    "src/routes/notes.new.tsx -> src/routes/+shared/editor.server.ts [reexport runtime]",
    // a pure barrel nothing imports (a types index, a package entry): a connection like any import
    "src/types/index.ts -> src/types/note.ts [reexport runtime]",
    "src/types/index.ts -> src/types/user.ts [reexport runtime]",
  ]);
});

const run = (tours: unknown[]) => {
  const g = Grouping.parse({ ...defaultGrouping(facts), tours });
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  return { model, ...resolveTours(g, model) };
};

test("the file graph and chain tours take a route's re-export as a hop", () => {
  const NEW = "src/routes/notes.new.tsx", EDITOR = "src/routes/+shared/editor.server.ts";
  const { model, tours, errors } = run([
    { title: "Saving a note", chain: [NEW, EDITOR, "src/lib/more.ts"] },
    { title: "Reading the cache", chain: ["src/routes/cache.tsx", "src/routes/cache.server.ts", "src/lib/make.ts"] },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(tours[0].steps.map((s) => s.via), [[NEW, EDITOR], [EDITOR, "src/lib/more.ts"]]);
  const pairs = new Set(model.fgraph!.map((e) => `${e[0]}>${e[1]}`));
  assert.ok(pairs.has(`${NEW}>${EDITOR}`));
  assert.ok(pairs.has("src/app.ts>src/lib/make.ts"));
  assert.ok(!pairs.has("src/lib/index.ts>src/lib/make.ts"), "a barrel's re-export is no edge");
});

test("an unimported barrel's re-export is a connection: it composes as a chain hop and is drawn", () => {
  const { model, errors } = run([{ title: "Types", chain: ["src/types/index.ts", "src/types/note.ts"] }]);
  assert.deepEqual(errors, []);
  assert.ok(model.fgraph!.some((e) => e[0] === "src/types/index.ts" && e[1] === "src/types/note.ts"));
});

test("an imported barrel's unused export and the hops of a barrel chain nobody used are edges", () => {
  const f = analyze(fileURLToPath(new URL("./fixtures/barrels", import.meta.url)));
  assert.deepEqual(edges(f).filter((x) => x.includes("[reexport")), [
    // app.ts is routed through kit -> inner to deep.ts and through kit to a.ts: those hops pass names through
    "src/kit/index.ts -> src/kit/a.ts [reexport]",
    // nobody used `b`, nor `s` in the inner barrel
    "src/kit/index.ts -> src/kit/b.ts [reexport runtime]",
    "src/kit/index.ts -> src/kit/inner/index.ts [reexport]",
    "src/kit/inner/index.ts -> src/kit/inner/deep.ts [reexport]",
    "src/kit/inner/index.ts -> src/kit/inner/spare.ts [reexport runtime]",
  ]);
});

// Every import is a file-graph edge (so on a board, drawn or listed), except a re-export an importer was routed past.
for (const name of ["reexports", "barrels", "mono", "deep", "library", "workspace", "remix-app", "next-app"]) {
  test(`the ${name} fixture has no import on no board`, () => {
    const f = analyze(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
    const g = Grouping.parse(defaultGrouping(f));
    const model = buildModel(f, g, assign(g, f).leafOf);
    const pairs = new Set(model.fgraph!.map((e) => `${e[0]}>${e[1]}`));
    const via = new Set(f.imports.flatMap((i) => (i.via ? [i.via] : [])));
    const passed = new Set(f.imports.filter((i) => i.kind === "reexport" && !i.runtime).map((i) => i.to));
    for (const i of f.imports) {
      if (i.from === i.to) continue;
      if (i.kind === "reexport" && !i.runtime) assert.ok(via.has(i.from) || passed.has(i.from), `${i.from} -> ${i.to} passes nothing through`);
      else assert.ok(pairs.has(`${i.from}>${i.to}`), `${i.from} -> ${i.to} is on no board`);
    }
  });
}
