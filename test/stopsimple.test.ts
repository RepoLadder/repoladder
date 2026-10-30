// The Simple stop on a repo with data stores (#210: turning the dial threw on every launch demo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { simpleStop as shipSimple } from "../src/model/simple.ts";
import { simpleTree } from "../src/model/splits.ts";
import { rollStop } from "../src/viewer/stops.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url)));
const leaf = (id: string, files: string[], split?: unknown) => ({ id, name: id, summary: `${id}.`, files, ...(split ? { split } : {}) });

test("Simple rolls up a repo with stores: store boards are not tree nodes", () => {
  const g = Grouping.parse({
    version: 1, summary: "Orders.",
    children: [
      leaf("web", ["web/**"], [
        { id: "web-db", name: "Firebase", summary: "Firebase.", files: ["web/src/firebase.ts", "web/src/constants.ts"] },
        { id: "web-orders", name: "Orders", summary: "Orders.", files: ["web/src/orders.ts"] },
      ]),
      leaf("server", ["server/**"]),
      leaf("functions", ["functions/**"]),
    ],
  });
  const leafOf = assign(g, facts).leafOf;
  const model = buildModel(facts, g, leafOf);
  const t = simpleTree(g, facts, leafOf);
  assert.ok(t, "the split is kept");
  model.simple = shipSimple(facts, model, t);
  const d = pageData(renderHtml(model, {}));
  const stores = Object.keys(d.stores ?? {}).filter((id) => d.boards[id]);
  assert.ok(stores.length, "the fixture has store boards");
  const s = rollStop(d, "simple");
  for (const id of stores) assert.ok(s.boards[id], id);
});
