import { test } from "node:test";
import assert from "node:assert/strict";
import { endpointLabel, sortMethods } from "../src/model/endpoints.ts";

test("sortMethods: upper-cases, dedupes, METHOD_ORDER first, unknown methods last alphabetically", () => {
  assert.deepEqual(sortMethods(["delete", "get", "get"]), ["GET", "DELETE"]);
  assert.deepEqual(sortMethods(["PURGE", "options", "LINK", "head", "post"]), ["HEAD", "POST", "OPTIONS", "LINK", "PURGE"]);
  assert.deepEqual(sortMethods([]), []);
});

test("endpointLabel: methods before the path, bare name without them", () => {
  assert.equal(endpointLabel({ name: "/tasks", methods: ["GET", "POST"] }), "GET, POST /tasks");
  assert.equal(endpointLabel({ name: "/tasks" }), "/tasks");
  assert.equal(endpointLabel({ name: "ping", methods: [] }), "ping");
});
