// #255: a narrative reference that validates must render as a link, so every id the model's
// narrative names is a box on the story board (or an actor or group the viewer resolves).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Grouping } from "../src/model/schema.ts";
import { storyRefs } from "../src/model/story.ts";

const stores = analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url)));
const grouping = (narrative: string[]): Grouping => ({
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
  story: {
    actors: [{ id: "shopper", name: "Shopper", summary: "Buys things.", kind: "person" }],
    uses: [{ actor: "shopper", part: "web", says: "places orders", entry: "web/src/orders.ts" }],
    narrative,
  },
});

test("story: [[svc-firestore]] and [[store-firestore]] both validate and link the Firestore store", () => {
  const narrative = [
    "A [[shopper]] saves orders in [[svc-firestore]].",
    "The [[admin|admin tools]] read them back from [[store-firestore|the order store]].",
    "Users live in [[svc-postgres]] and orders in [[store-supabase]].",
  ];
  const g = grouping(narrative);
  const a = assign(g, stores);
  assert.deepEqual(a.errors, []);
  const m = buildModel(stores, g, a.leafOf);
  assert.deepEqual(m.story!.narrative, [
    "A [[shopper]] saves orders in [[store-firestore]].",
    narrative[1],
    "Users live in [[store-prisma]] and orders in [[store-supabase]].",
  ]);
  const onBoard = new Set(m.story!.board.nodes);
  for (const s of m.story!.narrative)
    for (const r of storyRefs(s)) {
      if (r.id.startsWith("svc-") || r.id.startsWith("store-")) assert.ok(onBoard.has(r.id), `${r.id} is drawn on the story board`);
      else assert.ok(m.story!.actors[r.id] || m.nodes[r.id], `${r.id} is an actor or group`);
    }
});
