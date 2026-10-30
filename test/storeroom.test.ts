// #254: a group board draws the database its children read and write when it has room, instead of
// listing it "Used throughout" like an SDK every group imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET } from "../src/build/budget.ts";
import { finishGroupBoard, type RollEdge } from "../src/model/rollrules.ts";
import { ROOM, roomForStores } from "../src/model/storeroom.ts";

const use = (a: string, b: string, op: "r" | "w" | "rw" | "" = ""): RollEdge =>
  ({ a, b, imports: 0, calls: 0, uses: 2, major: false, ...(op.includes("r") ? { reads: 1 } : {}), ...(op.includes("w") ? { writes: 1 } : {}) });
const imp = (a: string, b: string): RollEdge => ({ a, b, imports: 3, calls: 0, uses: 0, major: false });
const board = (id: string, kids: string[], edges: RollEdge[]) =>
  finishGroupBoard(id, kids, edges, new Set(), new Set(edges.filter((e) => e.uses).map((e) => e.b)), () => true);
const drawnInto = (b: { edges: RollEdge[] }, s: string) => b.edges.filter((e) => e.b === s && e.major).map((e) => e.a);

test("storeroom: the room matches the digestibility budget", () => {
  assert.equal(ROOM.boxes, BUDGET.boxes);
  assert.equal(ROOM.edges, BUDGET.edges);
});

test("group board: a store most children use is drawn, an SDK they all use is still listed", () => {
  const kids = ["login", "verify", "onboarding", "github", "passkeys"];
  const edges = [
    ...kids.map((k, i) => use(k, "store-prisma", i === 3 ? "r" : "rw")),
    ...kids.map((k) => use(k, "svc-sentry")),
    imp("login", "verify"), imp("verify", "onboarding"), imp("github", "onboarding"), imp("passkeys", "login"),
  ];
  const b = board("auth", kids, edges);
  assert.ok(b.nodes.includes("store-prisma"));
  assert.deepEqual(b.throughout, ["svc-sentry"]);
  // at most 3 of its arrows, writers first; the rest stay listed as minor
  assert.deepEqual(drawnInto(b, "store-prisma").sort(), ["login", "onboarding", "passkeys"]);
  assert.equal(b.edges.filter((e) => e.b === "store-prisma").length, 5);
});

test("group board: a full board keeps the store listed; the root always draws it", () => {
  const kids = Array.from({ length: 12 }, (_, i) => `g${String(i).padStart(2, "0")}`);
  const edges = [...kids.slice(0, 5).map((k) => use(k, "store-db", "w")), ...kids.slice(1).map((k, i) => imp(k, kids[i]))];
  const full = board("part", kids, edges.map((e) => ({ ...e })));
  assert.ok(!full.nodes.includes("store-db"));
  assert.deepEqual(full.throughout, ["store-db"]);
  assert.deepEqual(drawnInto(full, "store-db"), []);
  const root = board("root", kids, edges.map((e) => ({ ...e })));
  assert.ok(root.nodes.includes("store-db"));
});

test("roomForStores: all its arrows when they fit, only the writers on a busy board, none on a full one", () => {
  const into = () => [use("a", "store-db", "r"), use("b", "store-db", "w"), use("c", "store-db", "rw")];
  let list = into();
  assert.deepEqual(roomForStores(list, ["store-db"], [], 8, 10), ["store-db"]);
  assert.deepEqual(list.filter((e) => e.major).map((e) => e.a).sort(), ["a", "b", "c"]);
  list = into();
  assert.deepEqual(roomForStores(list, ["store-db"], [], 8, 18), ["store-db"]);
  assert.deepEqual(list.filter((e) => e.major).map((e) => e.a).sort(), ["b", "c"]);
  list = [use("a", "store-db", "r"), use("b", "store-db", "r"), use("c", "store-db", "r")];
  assert.deepEqual(roomForStores(list, ["store-db"], [], 8, 18), [], "no writer to draw");
  assert.deepEqual(roomForStores(into(), ["store-db"], [], ROOM.boxes, 4), [], "no room for its box");
  assert.deepEqual(roomForStores(into(), ["store-db", "svc-x"], ["store-db"], 4, 4), [], "already drawn; services are not its business");
});
