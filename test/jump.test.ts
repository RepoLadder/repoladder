import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { back, backTitle, push, stack } from "../src/viewer/history.ts";
import { jumpOf, type JumpPage } from "../src/viewer/jump.ts";

// Shaped like a large app: root > web > web-billing, root > functions > fn-email / fn-billing.
const nodes: JumpPage["nodes"] = {
  root: { parent: null },
  web: { parent: "root" },
  "web-billing": { parent: "web" },
  "web-shell": { parent: "web" },
  functions: { parent: "root" },
  "fn-email": { parent: "functions" },
  "fn-billing": { parent: "functions" },
};
const layout = Object.fromEntries(["_story", "root", "web", "web-billing", "web-shell", "functions", "fn-email", "fn-billing", "store-firestore"].map((b) => [b, {}]));
const on = (context: string[], extra: Partial<JumpPage> = {}): JumpPage => ({ nodes, context, layout, stores: { "store-firestore": {} }, home: "_story", ...extra });

test("jump: a top-level elsewhere box goes to the overview and selects itself there", () => {
  assert.deepEqual(jumpOf(on(["functions"]), "functions"), { board: "_story", hit: "n:functions" });
  assert.deepEqual(jumpOf(on(["functions"], { home: "root" }), "functions"), { board: "root", hit: "n:functions" });
});

test("jump: a deeper elsewhere box goes to its parent's board, not into its own", () => {
  assert.deepEqual(jumpOf(on(["fn-billing"]), "fn-billing"), { board: "functions", hit: "n:fn-billing" });
  assert.deepEqual(jumpOf(on(["web-billing"]), "web-billing"), { board: "web", hit: "n:web-billing" });
});

test("jump: a store with a board opens it; a plain service and the board's own parts do not jump", () => {
  assert.deepEqual(jumpOf(on([]), "store-firestore"), { board: "store-firestore", hit: null });
  assert.equal(jumpOf(on([], { stores: {} }), "store-firestore"), null, "a store without collections has no board");
  assert.equal(jumpOf(on([]), "svc-stripe"), null);
  assert.equal(jumpOf(on(["functions"]), "web-billing"), null, "a part of this board drills in instead");
});

test("jump: no jump to a board that was not laid out", () => {
  const { functions: _, ...rest } = layout;
  assert.equal(jumpOf(on(["fn-billing"], { layout: rest }), "fn-billing"), null);
});

test("jump: the canvas's ← is the only way back, one press from where you jumped (#165)", () => {
  const src = (f: string) => readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8");
  // open() jumps through a plain show(), which records the board it leaves, so one Back returns there
  assert.match(src("navigate.ts"), /if \(!back && st\.svgEl && from !== id\) leaving\(here\(\)\)/);
  assert.match(src("navigate.ts"), /show\(j\.board, undefined, j\.hit \?\? null\)/);
  for (const f of ["jump.ts", "navigate.ts", "history.ts", "focuscorner.ts", "styles.css"]) assert.doesNotMatch(src(f), /jumpback/, `${f} has no back chip`);
  const s = stack<{ board: string; hit: string | null }>();
  const name = (id: string) => ({ "fn-email": "Email" })[id] ?? id;
  assert.equal(backTitle(s, name), "Back (Alt+←)");
  push(s, { board: "fn-email", hit: "n:web-billing" });
  assert.equal(backTitle(s, name), "Back to Email (Alt+←)");
  assert.deepEqual(back(s, { board: "web", hit: "n:web-billing" }), { board: "fn-email", hit: "n:web-billing" });
  assert.equal(backTitle(s, name), "Back (Alt+←)");
});
