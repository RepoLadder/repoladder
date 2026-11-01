// Resolving a citation to a part on a built fixture page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { defaultGrouping, assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { hashFor, parseHash } from "../src/viewer/deeplink.ts";
import { resolveRef } from "../src/viewer/locate.ts";
import { st, type ViewerData } from "../src/viewer/state.ts";

const facts = analyze(fileURLToPath(new URL("fixtures/basic-app", import.meta.url)));
const grouping = defaultGrouping(facts);
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);
const d: ViewerData = pageData(renderHtml(model, await layoutBoards(model)));
st.data = d;

test("a real file resolves to its leaf's board and part, and the link round-trips", () => {
  const f = resolveRef(d, { file: "src/lib/cart.ts", line: 2 })!;
  assert.ok(f);
  assert.equal(f.file, "src/lib/cart.ts");
  assert.ok(d.nodes[f.hit.slice(2)].files.some((p) => d.paths[p as number] === "src/lib/cart.ts"));
  assert.deepEqual(parseHash(d, hashFor(d, f.board, f.hit)), { board: f.board, hit: f.hit });
});

test("unknown files and boxes resolve to null; a box id resolves to its home board", () => {
  assert.equal(resolveRef(d, { file: "src/nope.ts" }), null);
  assert.equal(resolveRef(d, { box: "no-such-box" }), null);
  assert.equal(resolveRef(d, { box: "__proto__" }), null);
  const id = Object.values(d.nodes).find((n) => n.id !== "root" && n.parent)!.id;
  const b = resolveRef(d, { box: id })!;
  assert.equal(b.hit, `n:${id}`);
  assert.ok(d.layout[b.board]);
});
