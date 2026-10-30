import { test } from "node:test";
import assert from "node:assert/strict";
import { drawsEdge } from "../src/model/draws.ts";

const board = { nodes: ["a", "b", "c"], edges: [{ a: "a", b: "b", major: true }, { a: "b", b: "c", major: false }, { a: "a", b: "svc", major: true }] };

test("drawsEdge: true only for a major edge between two boxes, in its direction", () => {
  assert.equal(drawsEdge(board, "a", "b"), true);
  assert.equal(drawsEdge(board, "b", "c"), false, "minor is only listed");
  assert.equal(drawsEdge(board, "a", "svc"), false, "an end that is not a box has nowhere to point");
  assert.equal(drawsEdge(board, "b", "a"), false, "reverse direction");
  assert.equal(drawsEdge(board, "a", "c"), false, "no such edge");
});
