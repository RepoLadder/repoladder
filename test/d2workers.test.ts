import { test } from "node:test";
import assert from "node:assert/strict";
import { workerCount } from "../src/build/d2pool.ts";

const dflt = (cpus: number, mem: number) => Math.max(1, Math.min(6, cpus - 1, Math.floor(mem / 2 ** 31)));
const GB = 2 ** 30;

test("workerCount: unset keeps the default", () => {
  assert.equal(workerCount(undefined, undefined, 8, 32 * GB), 6);
  assert.equal(workerCount(undefined, undefined, 2, 32 * GB), 1);
  assert.equal(workerCount(undefined, undefined, 8, 4 * GB), 2);
  assert.equal(workerCount(undefined, undefined, 1, GB), 1);
});

test("workerCount: a valid env value wins, is clamped to 16 and bypasses the memory guard", () => {
  assert.equal(workerCount("4", undefined, 8, 32 * GB), 4);
  assert.equal(workerCount("16", undefined, 8, 32 * GB), 16);
  assert.equal(workerCount("17", undefined, 8, 32 * GB), 16);
  assert.equal(workerCount("12", undefined, 2, 2 * GB), 12);
});

test("workerCount: an invalid env value is ignored", () => {
  for (const bad of ["", "0", "-1", "-2", "abc", "2.5", "1.5", " 3", "3x"]) assert.equal(workerCount(bad, undefined, 8, 32 * GB), dflt(8, 32 * GB), JSON.stringify(bad));
});

test("workerCount: an explicit size beats the env", () => {
  assert.equal(workerCount("4", 2, 8, 32 * GB), 2);
  assert.equal(workerCount(undefined, 9, 2, GB), 9);
});
