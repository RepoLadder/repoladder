import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { edgeLabel, subLabel, subLines } from "../src/build/layout.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Facts, type Grouping } from "../src/model/schema.ts";
import { summarize } from "../src/model/summary.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url)));
const uses = (f: Facts) => f.storeUses.map((u) => `${u.store} ${u.collection} ${u.op} ${u.file}:${u.line}`);

test("stores: Firestore (web and admin), Prisma and Supabase reads and writes", () => {
  assert.deepEqual(facts.stores.map((s) => s.id), ["firestore", "prisma", "supabase"]);
  assert.deepEqual(uses(facts), [
    "firestore Companies read functions/src/admin.ts:11", // db.collection(CONST).doc(id).get()
    "firestore Companies/Therapists write functions/src/admin.ts:12", // helper returning a sub-collection
    "firestore Config write functions/src/admin.ts:13", // db.doc("Config/flags")
    "firestore Events read functions/src/admin.ts:14", // where/orderBy/limit chain
    "firestore Counters read functions/src/admin.ts:17", // tx.get(ref)
    "firestore Counters write functions/src/admin.ts:18", // tx.set(ref)
    "firestore Old write functions/src/admin.ts:21", // batch.delete
    // the "Untouched" reference only reads .id: no operation, so no fact
    "supabase orders read server/src/orders.ts:6",
    "supabase orders write server/src/orders.ts:7",
    // storage buckets and Buffer.from are not tables; prisma.$transaction is not a model
    "prisma user read server/src/users.ts:6",
    "prisma post write server/src/users.ts:7",
    "firestore Orders read web/src/orders.ts:8", // doc(db, IMPORTED_CONST, id)
    "firestore Orders read web/src/orders.ts:9", // getDocs(query(collection(...)))
    "firestore Orders write web/src/orders.ts:10", // doc(db, "Orders/abc")
    "firestore Orders/Items write web/src/orders.ts:11", // collection(db, A, id, B)
    "firestore Users write web/src/orders.ts:13", // imported object const, ref held in a variable
    "firestore Users write web/src/orders.ts:14",
    "firestore Orders/Items read web/src/orders.ts:15", // collectionGroup matched to its one known path
    "firestore Logs read web/src/orders.ts:16", // a returned query
    "firestore Orders write web/src/orders.ts:22",
    "firestore Orders write web/src/orders.ts:23",
    "firestore Logs read web/src/orders.ts:24",
  ]);
});

test("stores: old facts without stores still parse", () => {
  const { stores, storeUses, storeFields, ...old } = facts;
  const parsed = Facts.parse(old);
  assert.deepEqual(parsed.stores, []);
  assert.deepEqual(parsed.storeUses, []);
  assert.deepEqual(parsed.storeFields, []);
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

test("stores: model draws each store as a node with labeled edges and collections", () => {
  const m = buildModel(facts, grouping, assign(grouping, facts).leafOf);
  assert.equal(m.services["store-firestore"], "Firestore");
  const root = m.boards.root;
  assert.ok(root.nodes.includes("store-firestore"));
  const web = root.edges.find((e) => e.a === "web" && e.b === "store-firestore")!;
  assert.equal(web.reads, 5);
  assert.equal(web.writes, 6);
  assert.equal(edgeLabel(web), "reads & writes");
  assert.equal(web.major, true);
  const sb = m.boards.backend.edges.find((e) => e.a === "supa" && e.b === "store-supabase")!;
  assert.equal(edgeLabel(sb), "reads & writes");
  assert.deepEqual(m.boards.backend.edges.find((e) => e.a === "prisma-users")?.ev.map((x) => x[2]), ["user (read)"]);

  const fs = root.collections!["store-firestore"];
  assert.deepEqual(fs.map((c) => c.name), ["Companies", "Companies/Therapists", "Config", "Counters", "Events", "Logs", "Old", "Orders", "Orders/Items", "Users"]);
  const items = fs.find((c) => c.name === "Orders/Items")!;
  assert.deepEqual([items.reads, items.writes], [["web"], ["web"]]);
  assert.deepEqual(items.ev, [["web/src/orders.ts", 11, "write"], ["web/src/orders.ts", 15, "read"]]);
  assert.deepEqual(fs.find((c) => c.name === "Counters")!.reads, ["backend"]);

  // a store's cylinder always shows one count line, on every board (#326)
  assert.equal(subLabel(m, "store-firestore", "root"), "10 collections");
  assert.equal(subLabel(m, "store-firestore", "backend"), "6 collections");
  assert.equal(subLines(m, "store-firestore", "backend").length, 1);
  // a file board has no per-board collection list: it counts the whole store, never "0 collections"
  assert.ok(m.boards.web.nodes.includes("store-firestore") && !m.boards.web.collections?.["store-firestore"]);
  assert.equal(subLabel(m, "store-firestore", "web"), "10 collections");
});

test("stores: digest lists collections with read/write sides", () => {
  const d = summarize(facts);
  assert.match(d, /## Data stores/);
  assert.match(d, /- Orders\/Items: web\/src \(rw\)/);
  assert.match(d, /- Config: functions\/src \(w\)/);
});

test("stores: a database service merges into its store, the Firestore SDK too", () => {
  assert.deepEqual(facts.services.map((s) => s.id), ["firestore", "postgres", "supabase"]);
  const m = buildModel(facts, grouping, assign(grouping, facts).leafOf);
  assert.deepEqual(Object.keys(m.services).sort(), ["store-firestore", "store-prisma", "store-supabase"]);
  for (const b of Object.values(m.boards)) {
    assert.ok(!b.nodes.some((id) => id === "svc-postgres" || id === "svc-supabase" || id === "svc-firestore"));
    assert.ok(!b.edges.some((e) => e.b === "svc-postgres" || e.b === "svc-supabase" || e.b === "svc-firestore"));
  }
  // the Firestore SDK import is evidence on the store edge, not a box of its own
  assert.ok(m.boards.root.edges.some((e) => e.b === "store-firestore" && e.ev.some(([f, , what]) => f === "web/src/firebase.ts" && what === "firebase/firestore")));

  // an import of the client in a file with no reads or writes still reaches the store, as evidence
  const pkg = facts.files.find((f) => f.path === "server/src/users.ts")!.pkg;
  const extra: Facts = {
    ...facts,
    files: [...facts.files, { path: "server/src/types.ts", pkg, loc: 3 }],
    serviceUses: [...facts.serviceUses, { from: "server/src/types.ts", service: "postgres", spec: "@prisma/client", line: 1 }],
  };
  const backend = grouping.children[1];
  const g2: Grouping = { ...grouping, children: [grouping.children[0], { ...backend, children: [...backend.children!, { id: "types", name: "Types", summary: "", files: ["server/src/types.ts"] }] }] };
  const m2 = buildModel(extra, g2, assign(g2, extra).leafOf);
  const t = m2.boards.backend.edges.find((e) => e.a === "types")!;
  assert.equal(t.b, "store-prisma");
  assert.deepEqual([t.uses, t.reads, t.writes, t.ev], [1, undefined, undefined, [["server/src/types.ts", 1, "@prisma/client"]]]);
  const users = m2.boards.backend.edges.find((e) => e.a === "prisma-users")!;
  assert.deepEqual(users.ev.map((x) => x[2]), ["user (read)"]); // same file: the operation is the example
  assert.equal(users.uses, users.reads! + users.writes! + 1); // the import counts as a use
});
