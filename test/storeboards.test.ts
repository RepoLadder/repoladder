import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { FIELD_LINE_H, STORE_BOX_H, collSub, nameWidth, storeBoxSizes, storeLayout } from "../src/build/storelayout.ts";
import type { Model } from "../src/model/rollup.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { prismaSchema } from "../src/analyze/fields.ts";
import { STORE_BOXES, buildStoreBoards, collLabel, parentColl, storeReaders } from "../src/model/storeboards.ts";
import { BUDGET } from "../src/build/budget.ts";
import { lintBoard } from "../src/build/lint.ts";
import { resolveTours } from "../src/model/tours.ts";
import type { Facts, Grouping } from "../src/model/schema.ts";
import { unpack } from "../src/viewer/unpack.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url)));
const fields = (f: Facts) => f.storeFields.map((x) => `${x.store} ${x.collection}.${x.field} ${x.how} ${x.file}:${x.line}`);

test("fields: written keys, queried fields, properties read back, and Prisma's declared ones", () => {
  assert.deepEqual(fields(facts), [
    // const { plan, seats: count } = company.data() ?? {}; const d = company.data()!; d.owner, d["region"]; company.get("tier")
    "firestore Companies.owner read functions/src/admin.ts:25",
    "firestore Companies.plan read functions/src/admin.ts:23",
    "firestore Companies.region read functions/src/admin.ts:25",
    "firestore Companies.seats read functions/src/admin.ts:23",
    "firestore Companies.tier read functions/src/admin.ts:25",
    // a helper's sub-collection; the { merge: true } options are not data
    "firestore Companies/Therapists.active write functions/src/admin.ts:12",
    "firestore Companies/Therapists.name write functions/src/admin.ts:12",
    "firestore Config.flags write functions/src/admin.ts:13", // "flags.beta" updates the top-level field
    "firestore Counters.n read functions/src/admin.ts:17", // (await tx.get(ref)).data()?.n
    "firestore Counters.n write functions/src/admin.ts:18", // tx.set(ref, data)
    "firestore Events.at query functions/src/admin.ts:14",
    "firestore Events.kind query functions/src/admin.ts:14",
    "firestore Logs.at query web/src/orders.ts:24", // query(collection, orderBy("at"))
    "firestore Logs.msg read web/src/orders.ts:25", // for (const d of snap.docs) d.get("msg")
    "firestore Orders.by write web/src/orders.ts:21", // patch.by = ... on the object written
    "firestore Orders.open query web/src/orders.ts:9",
    "firestore Orders.seen write web/src/orders.ts:20",
    "firestore Orders.status write web/src/orders.ts:28", // ...BASE, a const declared below
    "firestore Orders.total read web/src/orders.ts:10", // o.data()!.total
    "firestore Orders.total write web/src/orders.ts:10",
    // setDoc(ref, dynamic): a parameter, so nothing
    "firestore Orders/Items.qty write web/src/orders.ts:11",
    "firestore Orders/Items.sku read web/src/orders.ts:15", // a listener's snapshot, through docs.map
    "firestore Orders/Items.sku write web/src/orders.ts:11",
    "firestore Users.lastSeen write web/src/orders.ts:13", // updateDoc(ref, "lastSeen", 1)
    "prisma post. declared server/prisma/schema.prisma:14",
    "prisma post.author declared server/prisma/schema.prisma:17",
    "prisma post.authorId declared server/prisma/schema.prisma:18",
    "prisma post.id declared server/prisma/schema.prisma:15",
    "prisma post.title declared server/prisma/schema.prisma:16",
    "prisma post.title write server/src/users.ts:7",
    "prisma user. declared server/prisma/schema.prisma:6",
    "prisma user.email declared server/prisma/schema.prisma:8",
    "prisma user.email query server/src/users.ts:6",
    "prisma user.id declared server/prisma/schema.prisma:7",
    "prisma user.id read server/src/users.ts:6", // select
    "prisma user.name declared server/prisma/schema.prisma:9",
    "prisma user.name query server/src/users.ts:6", // inside OR
    "prisma user.posts declared server/prisma/schema.prisma:10",
    "supabase orders.id query server/src/orders.ts:6",
    "supabase orders.id read server/src/orders.ts:6",
    "supabase orders.id write server/src/orders.ts:7",
    "supabase orders.total read server/src/orders.ts:6",
  ]);
  // same repo, same facts
  assert.deepEqual(analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url))).storeFields, facts.storeFields);
});

test("fields: a Prisma schema's models and fields, skipping attributes and comments", () => {
  assert.deepEqual(prismaSchema("model BlogPost {\n  id Int @id // the key\n  tags String[]\n  @@index([id])\n}\nenum Role {\n  ADMIN\n}\n"), [
    { model: "blogPost", field: "", line: 1 },
    { model: "blogPost", field: "id", line: 2 },
    { model: "blogPost", field: "tags", line: 3 },
  ]);
});

const grouping: Grouping = {
  version: 1,
  summary: "",
  children: [
    { id: "web", name: "Web", summary: "", files: ["web/**"] },
    { id: "backend", name: "Backend", summary: "", children: [
      { id: "admin", name: "Admin", summary: "", files: ["functions/**"] },
      { id: "prisma-users", name: "Users", summary: "", files: ["server/src/users.ts"] },
      { id: "supa", name: "Supa", summary: "", files: ["server/src/orders.ts"] },
    ] },
  ],
};
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);

test("store boards: one box per collection, readers and writers one level down as context, no invented arrows", () => {
  const b = model.boards["store-firestore"];
  assert.deepEqual(b.nodes, ["c:Companies", "c:Companies/Therapists", "c:Config", "c:Counters", "c:Events", "c:Logs", "c:Old", "c:Orders", "c:Orders/Items", "c:Users", "admin", "web"]);
  assert.deepEqual(b.context, ["admin", "web"]);
  // every edge is a store use: part -> collection, with reads/writes and file:line evidence
  for (const e of b.edges) {
    assert.ok(facts.storeUses.some((u) => u.store === "firestore" && `c:${u.collection}` === e.b && e.ev.some(([f, l]) => f === u.file && l === u.line)), `${e.a} -> ${e.b}`);
    assert.equal(e.major, false); // drawn by the viewer for the selection only
  }
  const items = b.edges.find((e) => e.a === "web" && e.b === "c:Orders/Items")!;
  assert.deepEqual([items.reads, items.writes, items.uses], [1, 1, 2]);
  assert.deepEqual(model.boards["store-prisma"].context, ["prisma-users"]);
  // the story/tour machinery never picks a store board on its own
  assert.deepEqual(resolveTours({ ...grouping, tours: [{ id: "t", title: "T", steps: [{ text: "x", node: "admin" }] }] }, model).tours[0].steps[0].board, "backend");
});

test("store boards: fields per collection, declared ones first in schema order, then most used", () => {
  const fs = model.stores!["store-firestore"];
  assert.deepEqual(fs.Orders.fields.map((f) => [f.name, f.hows.join("+"), f.sites]), [["total", "write+read", 2], ["by", "write", 1], ["open", "query", 1], ["seen", "write", 1], ["status", "write", 1]]);
  assert.deepEqual(fs.Orders.fields[0].ev, [["web/src/orders.ts", 10, "write"], ["web/src/orders.ts", 10, "read"]]);
  const user = model.stores!["store-prisma"].user.fields;
  assert.deepEqual(user.map((f) => [f.name, !!f.declared, f.hows.join("+")]), [["id", true, "read"], ["email", true, "query"], ["name", true, "query"], ["posts", true, ""]]);
  assert.equal(user[1].ev[0][2], "declared");
});

test("store boards: a subcollection's parent is a box even when the code never touches it", () => {
  const f: Facts = { ...facts, stores: [{ id: "firestore", name: "Firestore" }], storeFields: [], storeUses: [{ store: "firestore", collection: "A/B/C", op: "read", file: "web/src/orders.ts", line: 1 }] };
  const { boards } = buildStoreBoards(f, model.nodes, assign(grouping, f).leafOf);
  assert.deepEqual(boards["store-firestore"].nodes, ["c:A", "c:A/B", "c:A/B/C", "web"]);
  assert.deepEqual([parentColl("A/B/C"), parentColl("A"), parentColl("*/x"), collLabel("A/B/C"), collLabel("*/x")], ["A/B", null, null, "C", "x (any parent)"]);
});

test("store layout: one lattice of same-size cells, subcollections framed inside their parent", async () => {
  const sizes = storeBoxSizes(model, "store-firestore");
  assert.equal(new Set(Object.entries(sizes).filter(([id]) => id.startsWith("c:")).map(([, s]) => s.join())).size, 1, "collections share one size");
  assert.deepEqual([collSub(12, 0), collSub(1, 1), collSub(0, 2)], ["12 fields", "1 field · 1 subcollection", "no fields seen · 2 subcollections"]);
  assert.ok(nameWidth("PasswordResetEmailGuardLogs") > 227 && nameWidth("Kiosks") < 50.7, "measured glyph widths");

  const layout = await layoutBoards(model);
  const n = layout["store-firestore"].n;
  assert.deepEqual(n.map((x) => x[0]).sort(), [...model.boards["store-firestore"].nodes].sort());
  assert.deepEqual(layout["store-firestore"].e, [], "the viewer draws the selection's arrows; nothing to route");
  const box = (id: string) => n.find((x) => x[0] === id)!;
  const [, cx, cy, cw, ch] = box("c:Companies"), [, tx, ty, tw, th] = box("c:Companies/Therapists");
  assert.ok(tx > cx && ty > cy && tx + tw < cx + cw && ty + th < cy + ch, "Therapists sits inside Companies");
  assert.ok(ty - cy >= STORE_BOX_H, "Companies keeps a row for its own name above its subcollections");
  // rows line up across the board: every cell's top is a whole number of rows from the first
  const plain = n.filter(([id]) => !n.some(([k]) => k.startsWith(`${id}/`)));
  const tops = [...new Set(plain.map(([, , y]) => y))].sort((a, b) => a - b);
  for (const y of tops) assert.equal((y - tops[0]) % (tops[1] - tops[0]), 0, `row at ${y}`);
  const data = await unpack(pageData(renderHtml(model, layout)));
  assert.ok(data.layout["store-firestore"]);
  const orders = data.stores!["store-firestore"].Orders;
  assert.deepEqual(orders[0].slice(0, 3), ["total", "wr", 2]);
  assert.equal(data.paths[orders[0][3] as number], "web/src/orders.ts");
  assert.deepEqual(data.stores!["store-prisma"].user[0].slice(0, 2), ["id", "dr"]);
});

test("store layout: a big store fills the landscape canvas, and frames never sit side by side", () => {
  // 30 top-level collections, two of them holding subcollections, and six parts reading them
  const colls = [...Array.from({ length: 30 }, (_, i) => `Coll${String(i).padStart(2, "0")}`), "Coll00/A", "Coll00/B", "Coll00/C", "Coll01/D"];
  const parts = Array.from({ length: 6 }, (_, i) => `p${i}`);
  const m = {
    nodes: Object.fromEntries(parts.map((id) => [id, { name: `Part ${id}`, parent: "root" }])),
    boards: { "store-x": { nodes: [...colls.map((c) => `c:${c}`), ...parts], edges: [], throughout: [], hubs: [], context: parts } },
    stores: { "store-x": Object.fromEntries(colls.map((c) => [c, { fields: [] }])) },
  } as unknown as Model;
  const { n } = storeLayout(m, "store-x");
  const xs = n.flatMap(([, x, , w]) => [x, x + w]), ys = n.flatMap(([, , y, , h]) => [y, y + h]);
  const W = Math.max(...xs) - Math.min(...xs), H = Math.max(...ys) - Math.min(...ys);
  assert.ok(W > H && W / H < 2.2, `landscape, not a strip: ${W}×${H}`);
  assert.deepEqual(storeLayout(m, "store-x"), { n, e: [] }, "deterministic");
  const frames = n.filter(([id]) => id === "c:Coll00" || id === "c:Coll01").map(([, x, y, w, h]) => ({ x, y, w, h }));
  const [a, b] = frames, gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  assert.ok(gapX > 12 || gapY > 12, "two frames keep apart");
});

test("store layout knobs (experimental only): field lines make every cell taller; flat packs subcollections as cells", () => {
  const colls = ["A", "A/B", "A/C", "D"];
  const m = {
    nodes: { p: { name: "Part p", parent: "root" } },
    boards: { "store-x": { nodes: [...colls.map((c) => `c:${c}`), "p"], edges: [], throughout: [], hubs: [], context: ["p"] } },
    stores: { "store-x": Object.fromEntries(colls.map((c) => [c, { fields: [{ name: "aVeryLongFieldNameIndeed" }, { name: "b" }] }])) },
  } as unknown as Model;
  const plain = storeBoxSizes(m, "store-x"), tall = storeBoxSizes(m, "store-x", { fields: 2 });
  assert.equal(tall["c:D"][1], STORE_BOX_H + 2 * FIELD_LINE_H);
  assert.equal(tall["p"][1], tall["c:D"][1], "all boxes share one height");
  assert.ok(tall["c:D"][0] >= plain["c:D"][0], "room for the longest field name");
  assert.deepEqual(storeBoxSizes(m, "store-x", { flat: true }), plain, "flat keeps the cells' size, count line included");
  const nested = storeLayout(m, "store-x").n, flat = storeLayout(m, "store-x", { flat: true }).n;
  const cell = (n: typeof flat, id: string) => n.find((x) => x[0] === id)!;
  assert.ok(cell(nested, "c:A")[3] > cell(nested, "c:D")[3], "nested: A frames B and C");
  assert.deepEqual(cell(flat, "c:A").slice(3), cell(flat, "c:D").slice(3), "flat: A is a cell like any other");
  assert.deepEqual(storeLayout(m, "store-x"), storeLayout(m, "store-x", {}), "no options: the build's layout");
});

test("store readers: one level down when they fit, else the top level, else listed in the panel", () => {
  assert.equal(STORE_BOXES, BUDGET.boxes, "the page's copy of the box budget");
  const t = (c: number, p: number, top: number) => storeReaders(c, p, top);
  assert.deepEqual([t(8, 4, 2), t(12, 0, 0), t(9, 4, 2), t(11, 4, 2), t(12, 1, 1)], ["parts", "parts", "top", "listed", "listed"]);
});

/** `n` collections, each written by admin, read by web, and (by turns) read by Users or Supa. */
const manyColls = (n: number): Facts => {
  const uses: Facts["storeUses"] = [];
  for (let i = 0; i < n; i++) {
    const c = `T${String(i).padStart(2, "0")}`;
    uses.push({ store: "firestore", collection: c, op: "write", file: "functions/src/admin.ts", line: 10 + i });
    uses.push({ store: "firestore", collection: c, op: "read", file: "web/src/orders.ts", line: 10 + i });
    uses.push({ store: "firestore", collection: c, op: "read", file: i % 2 ? "server/src/orders.ts" : "server/src/users.ts", line: 10 + i });
    if (i === 0) uses.push({ store: "firestore", collection: c, op: "write", file: "server/src/orders.ts", line: 50 });
  }
  return { ...facts, stores: [{ id: "firestore", name: "Firestore" }], storeFields: [], storeUses: uses };
};
const realUses = (f: Facts, b: { edges: { b: string; ev: [string, number, unknown][]; major: boolean }[] }) => {
  for (const e of b.edges) {
    assert.equal(e.major, false);
    assert.ok(e.ev.length && e.ev.every(([file, l]) => f.storeUses.some((u) => `c:${u.collection}` === e.b && u.file === file && u.line === l)), e.b);
  }
};

test("store boards: readers that don't fit fold up to the top-level parts, their arrows summed", () => {
  const f = manyColls(9), leafOf = assign(grouping, f).leafOf;
  const b = buildStoreBoards(f, model.nodes, leafOf).boards["store-firestore"];
  assert.deepEqual(b.context, ["backend", "web"]);
  assert.equal(b.nodes.length, 11);
  realUses(f, b);
  // T00: admin writes it, Users reads it, Supa writes it; folded up, Backend's arrow is all three
  const e = b.edges.find((x) => x.a === "backend" && x.b === "c:T00")!;
  assert.deepEqual([e.uses, e.reads, e.writes], [3, 1, 2]);
  assert.equal(b.edges.find((x) => x.a === "backend" && x.b === "c:T01")!.uses, 2, "admin's write and Supa's read");
});

test("store boards: with too many readers even a level up, only the collections are drawn and the panels list them", async () => {
  const f = manyColls(11), leafOf = assign(grouping, f).leafOf;
  const b = buildStoreBoards(f, model.nodes, leafOf).boards["store-firestore"];
  assert.ok(b.nodes.every((id) => id.startsWith("c:")) && b.nodes.length === 11);
  assert.deepEqual(b.context, []);
  assert.deepEqual([...new Set(b.edges.map((e) => e.a))].sort(), ["admin", "prisma-users", "supa", "web"], "edges keep the parts one level down");
  realUses(f, b);
  const m = buildModel(f, grouping, leafOf), l = storeLayout(m, "store-firestore");
  assert.deepEqual(l.n.map((x) => x[0]).sort(), b.nodes);
  assert.deepEqual(lintBoard(m, "store-firestore", l).defects, []);
});
