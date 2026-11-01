import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { starterQuestions } from "../src/model/starters.ts";

const facts = (name: string) => analyze(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)));

test("starters are deterministic, capped at 4, and only what the facts support", () => {
  for (const name of ["stores", "checkin", "basic-app"]) {
    const f = facts(name), a = starterQuestions(f);
    assert.deepEqual(a, starterQuestions(f), name);
    assert.ok(a.length >= 1 && a.length <= 4, name);
    assert.equal(new Set(a).size, a.length, name);
  }
});

test("each starter appears only when its facts exist", () => {
  const f = facts("stores");
  assert.ok(f.storeUses.length > 0);
  assert.equal(starterQuestions(f)[0], "What touches the database?");
  const bare = { ...f, storeUses: [], serviceUses: [], services: [], calls: [], pages: [] };
  assert.deepEqual(starterQuestions(bare), ["Where should I start reading this codebase?"]);
  assert.deepEqual(starterQuestions(null), []);
});

test("the endpoint starter names the most called endpoint, ties by name", () => {
  const f = facts("checkin");
  const base = { ...f, storeUses: [], serviceUses: [], services: [], pages: [] };
  const call = (endpoint: string) => ({ from: "a.ts", line: 1, to: "b.ts", endpoint, kind: "callable" as const });
  assert.equal(starterQuestions({ ...base, calls: [call("zeta"), call("alpha")] })[0], "Who calls `alpha`?");
  assert.equal(starterQuestions({ ...base, calls: [call("zeta"), call("zeta"), call("alpha")] })[0], "Who calls `zeta`?");
});

test("a service of category database counts as touching the database", () => {
  const f = facts("stores");
  const bare = { ...f, storeUses: [], calls: [], pages: [], services: [{ id: "s", name: "S", category: "database" as const }], serviceUses: [{ from: "a.ts", service: "s", spec: "s", line: 1 }] };
  assert.equal(starterQuestions(bare)[0], "What touches the database?");
});
