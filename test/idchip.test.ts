import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeId, idRow } from "../src/viewer/idchip.ts";
import { buildViewer } from "../src/build/viewer.ts";

test("panel ids: node ids as-is, edges as a→b, escaped, with a copy button", () => {
  assert.equal(edgeId("web-billing", "fn-billing"), "web-billing→fn-billing");
  const row = idRow(edgeId("web-billing", "fn-billing"));
  assert.match(row, /<code>web-billing→fn-billing<\/code>/);
  assert.match(row, /data-copy="web-billing→fn-billing"/);
  assert.match(idRow('a"<b'), /<code>a&quot;&lt;b<\/code>/);
});

test("the viewer bundle includes the id row and its copy handler", () => {
  const { js } = buildViewer();
  assert.ok(js.includes("idrow") && js.includes("data-copy"));
});
