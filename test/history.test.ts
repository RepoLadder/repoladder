import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMIT, back, depth, forward, leaving, mark, push, record, rewind, stack } from "../src/viewer/history.ts";

test("history: back returns where you were, forward undoes it", () => {
  const s = stack<string>();
  assert.equal(back(s, "a"), null, "nothing behind the first board");
  assert.deepEqual(s, { back: [], fwd: [] });
  push(s, "a"); // a → b
  push(s, "b"); // b → c
  assert.equal(back(s, "c"), "b");
  assert.equal(back(s, "b"), "a");
  assert.equal(back(s, "a"), null);
  assert.equal(forward(s, "a"), "b");
  assert.equal(forward(s, "b"), "c");
  assert.equal(forward(s, "c"), null);
  assert.deepEqual(s.back, ["a", "b"]);
});

test("history: going somewhere new after Back drops the forward branch", () => {
  const s = stack<string>();
  push(s, "a");
  push(s, "b");
  assert.equal(back(s, "c"), "b");
  assert.deepEqual(s.fwd, ["c"]);
  push(s, "b"); // b → d
  assert.deepEqual(s.fwd, []);
  assert.equal(forward(s, "d"), null);
  assert.equal(back(s, "d"), "b");
  assert.equal(back(s, "b"), "a");
});

test("history: places keep their selection and view; the stack is bounded", () => {
  const s = stack<{ board: string; hit: string | null; view: number[] }>();
  const at = { board: "web-billing", hit: "n:billing-ui", view: [10, 20, 300, 200] };
  push(s, at);
  assert.deepEqual(back(s, { board: "functions", hit: null, view: [0, 0, 1, 1] }), at);
  for (let i = 0; i < LIMIT + 5; i++) push(s, { board: `b${i}`, hit: null, view: [] });
  assert.equal(s.back.length, LIMIT);
  assert.equal(s.back[0].board, "b5");
});

test("history: a tour step replaces the board change recorded under it", () => {
  const p = (board: string, tour?: [string, number]) => ({ board, hit: null, view: [], tour });
  leaving(p("root")); // the tour's first step opened a board
  const keep = depth();
  leaving(p("web")); // step 2 opened another: show() recorded the untagged board...
  record(p("web", ["t", 0]), keep); // ...which the tagged step replaces
  assert.equal(depth(), keep + 1);
  const at = mark();
  leaving(p("api")); // a replayed step's own board change
  rewind(at);
  assert.deepEqual(mark(), at);
});
