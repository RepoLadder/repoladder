// The `overlay` build option: schema, validation errors, resolving against the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAllPaths } from "../src/analyze/files.ts";
import { ENGINE_FEATURES, buildFromFiles } from "../src/lib.ts";

const dir = (n: string) => fileURLToPath(new URL(`fixtures/${n}`, import.meta.url));
const filesOf = (d: string) => new Map(listAllPaths(d).filter((p) => existsSync(join(d, p))).map((p) => [p, readFileSync(join(d, p), "utf8")] as [string, string]));
import { Overlay, resolveOverlay } from "../src/model/overlay.ts";

const deep = filesOf(dir("deep"));
const grouping = JSON.parse(deep.get("grouping.json")!);
const full = {
  changed: ["n:api"], added: ["n:svc-stripe"], addedEdges: ["e:app>svc-stripe"], removedEdges: ["e:api>svc-stripe"],
  parts: [{ id: "n:api", files: 2 }, { id: "n:app" }],
};

test("the schema accepts a full overlay and an empty one", () => {
  assert.ok(Overlay.safeParse(full).success);
  assert.ok(Overlay.safeParse({}).success);
});

test("the schema rejects a bad id shape, an unknown key and an oversize list", () => {
  assert.ok(!Overlay.safeParse({ changed: ["api"] }).success, "a box id needs the n: prefix");
  assert.ok(!Overlay.safeParse({ changed: ["e:a>b"] }).success, "a connection id is not a box id");
  assert.ok(!Overlay.safeParse({ addedEdges: ["e:a"] }).success, "a connection id needs both ends");
  assert.ok(!Overlay.safeParse({ addedEdges: ["e:a>b>c"] }).success);
  assert.ok(!Overlay.safeParse({ changed: ["n:a b"] }).success, "no whitespace in an id");
  assert.ok(!Overlay.safeParse({ colour: [] }).success, "unknown keys are refused");
  assert.ok(!Overlay.safeParse({ changed: Array.from({ length: 2001 }, (_, i) => `n:x${i}`) }).success);
  assert.ok(!Overlay.safeParse({ parts: [{ id: "n:a", files: -1 }] }).success);
});

test("a malformed overlay throws INVALID_SCHEMA naming the path", async () => {
  await assert.rejects(
    buildFromFiles(deep, { grouping, overlay: { changed: ["api"] } as never }),
    (e: Error & { code?: string }) => e.name === "BuildError" && e.code === "INVALID_SCHEMA" && /INVALID overlay\n {2}changed\.0:/.test(e.message),
  );
});

test("known ids are applied; well-formed unknown ids are dropped and counted, never thrown", async () => {
  const r = await buildFromFiles(deep, { grouping, overlay: { ...full, changed: ["n:api", "n:gone"], removedEdges: ["e:api>svc-stripe", "e:api>gone"], parts: [{ id: "n:api" }, { id: "n:gone" }] } });
  assert.ok(r.ok);
  assert.deepEqual(r.overlay, {
    applied: { changed: 1, added: 1, addedEdges: 1, removedEdges: 1, parts: 1 },
    dropped: { changed: 1, added: 0, addedEdges: 0, removedEdges: 1, parts: 1 },
  });
});

test("a build without the option returns no overlay key", async () => {
  const r = await buildFromFiles(deep, { grouping });
  assert.ok(r.ok);
  assert.ok(!("overlay" in r));
});

test("resolveOverlay keeps ids once, names parts from the model and accepts services", async () => {
  const r = await buildFromFiles(deep, { grouping });
  assert.ok(r.ok);
  const { marks } = resolveOverlay({ changed: ["n:api", "n:api"], parts: [{ id: "n:api", files: 2 }, { id: "n:api" }, { id: "n:svc-stripe" }] }, r.model);
  assert.deepEqual(marks.changed, ["n:api"]);
  assert.deepEqual(marks.parts.map((p) => [p.id, p.name, p.files]), [["api", "API server", 2], ["svc-stripe", r.model.services["svc-stripe"], undefined]]);
});

test("the schema accepts the part shape a consumer sends: bare or prefixed ids, filesChanged, a name", () => {
  const r = Overlay.safeParse({ parts: [{ id: "api", name: "Old name", filesChanged: 3 }, { id: "n:app", files: 1, filesChanged: 9 }] });
  assert.ok(r.success);
  assert.deepEqual(r.data.parts, [{ id: "n:api", files: 3 }, { id: "n:app", files: 1 }], "ids are prefixed, files wins over its alias, name is gone");
});

test("a part still refuses unknown keys and a malformed id", () => {
  assert.ok(!Overlay.safeParse({ parts: [{ id: "api", colour: "red" }] }).success);
  assert.ok(!Overlay.safeParse({ parts: [{ id: "a b" }] }).success);
  assert.ok(!Overlay.safeParse({ parts: [{ id: "" }] }).success);
  assert.ok(!Overlay.safeParse({ parts: Array.from({ length: 201 }, () => ({ id: "api" })) }).success);
});

test("through buildFromFiles: the consumer's payload applies, and a bad one throws INVALID_SCHEMA", async () => {
  const r = await buildFromFiles(deep, { grouping, overlay: { changed: ["n:api"], parts: [{ id: "api", name: "stale", filesChanged: 2 }] } });
  assert.ok(r.ok);
  assert.equal(r.overlay?.applied.parts, 1);
  for (const bad of [{ colour: [] }, { parts: [{ id: "api", extra: 1 }] }, { changed: ["api"] }, { changed: Array.from({ length: 2001 }, (_, i) => `n:x${i}`) }]) {
    await assert.rejects(buildFromFiles(deep, { grouping, overlay: bad as never }), (e: Error & { code?: string }) => e.code === "INVALID_SCHEMA");
  }
});

test("a connection end that is a file path is lifted to its box, deduplicated, and dropped when it stays in one box", async () => {
  const r = await buildFromFiles(deep, { grouping });
  assert.ok(r.ok);
  const api = r.model.nodes["api"].files[0], shell = r.model.nodes["shell"].files[0];
  const { marks, report } = resolveOverlay(
    Overlay.parse({
      addedEdges: [`e:${shell}>${api}`, "e:shell>api", `e:${api}>${api}`, `e:${shell}>react`, "e:api>svc-stripe"],
      removedEdges: [`e:${api}>svc-stripe`],
    }),
    r.model,
  );
  assert.deepEqual(marks.addedEdges, ["e:shell>api", "e:api>svc-stripe"], "lifted and plain ids dedupe; same-box and unknown ends are dropped");
  assert.deepEqual(marks.removedEdges, ["e:api>svc-stripe"]);
  assert.equal(report.dropped.addedEdges, 3);
});

test("ENGINE_FEATURES names the overlay option", () => {
  assert.ok((ENGINE_FEATURES as readonly string[]).includes("overlay"));
});
