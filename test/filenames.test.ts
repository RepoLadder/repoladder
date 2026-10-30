import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { fileBoxLabel } from "../src/build/filelayout.ts";
import { boxName, boxStem, distinctNames, fileNames } from "../src/model/filenames.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { modelRoles, resolveFlows } from "../src/model/flows.ts";

test("a repeated basename is named by the shortest tail no other file in the leaf shares", () => {
  const names = distinctNames([
    "app/(chat)/api/chat/route.ts",
    "app/(chat)/api/chat/[id]/stream/route.ts",
    "app/(chat)/api/vote/route.ts",
    "app/(chat)/api/history/route.ts",
    "lib/db/queries.ts",
  ]);
  assert.deepEqual(Object.fromEntries(names), {
    "app/(chat)/api/chat/route.ts": "chat/route.ts",
    "app/(chat)/api/chat/[id]/stream/route.ts": "stream/route.ts",
    "app/(chat)/api/vote/route.ts": "vote/route.ts",
    "app/(chat)/api/history/route.ts": "history/route.ts",
  });
});

test("tails grow until they differ, and a route parameter keeps its folder", () => {
  const names = distinctNames(["a/x/index.ts", "b/x/index.ts", "c/index.ts", "index.ts", "api/users/[id]/route.ts", "api/me/route.ts"]);
  assert.equal(names.get("a/x/index.ts"), "a/x/index.ts");
  assert.equal(names.get("b/x/index.ts"), "b/x/index.ts");
  assert.equal(names.get("c/index.ts"), "c/index.ts");
  assert.equal(names.get("index.ts"), "index.ts");
  assert.equal(names.get("api/users/[id]/route.ts"), "users/[id]/route.ts");
  assert.equal(names.get("api/me/route.ts"), "me/route.ts");
});

test("a long tail drops its middle folders unless two names would then match", () => {
  const long = distinctNames(["packages/excalidraw/fonts/Virgil/index.ts", "packages/excalidraw/fonts/Cascadia/index.ts", "fonts/somewhat-long-folder/deeper/index.ts", "other/somewhat-long-folder/deeper/index.ts"]);
  assert.equal(long.get("packages/excalidraw/fonts/Virgil/index.ts"), "Virgil/index.ts");
  assert.equal(long.get("fonts/somewhat-long-folder/deeper/index.ts"), "fonts/…/index.ts");
  assert.equal(long.get("other/somewhat-long-folder/deeper/index.ts"), "other/…/index.ts");
  const pkgs = distinctNames(["packages/utils/src/index.ts", "packages/fractional-indexing/src/index.ts", "packages/excalidraw/index.ts", "x/src/index.ts", "x/index.ts"]);
  assert.equal(pkgs.get("packages/utils/src/index.ts"), "utils/src/index.ts", "x/src and x would both be x/index.ts");
  const noSrc = distinctNames(["packages/utils/src/index.ts", "packages/fractional-indexing/src/index.ts", "packages/excalidraw/index.ts"]);
  assert.equal(noSrc.get("packages/utils/src/index.ts"), "utils/index.ts");
  assert.equal(noSrc.get("packages/fractional-indexing/src/index.ts"), "fractional-indexing/index.ts");
  // a route parameter is what tells routes apart, so a long tail keeps it
  const routes = distinctNames(["app/(auth)/api/auth/[...nextauth]/route.ts", "app/(auth)/api/auth/guest/route.ts"]);
  assert.equal(routes.get("app/(auth)/api/auth/[...nextauth]/route.ts"), "auth/[...nextauth]/route.ts");
  // both s/ files would shorten to "s/…/index.ts"
  const clash = distinctNames(["s/long-middle-one/index.ts", "t/long-middle-one/index.ts", "s/long-middle-two/index.ts", "u/long-middle-two/index.ts"]);
  assert.equal(clash.get("s/long-middle-one/index.ts"), "s/long-middle-one/index.ts");
  assert.equal(clash.get("u/long-middle-two/index.ts"), "u/long-middle-two/index.ts");
});

test("names are per leaf: the same basename in two leaves keeps its basename", () => {
  const names = fileNames([
    { files: ["a/route.ts", "a/util.ts"], children: [] },
    { files: ["b/route.ts"], children: [] },
    { files: [], children: ["x"] },
  ]);
  assert.deepEqual(names, {});
  assert.equal(boxName(names, "a/route.ts"), "route.ts");
  assert.equal(boxStem({ "a/b/route.ts": "b/route.ts" }, "a/b/route.ts"), "b/route");
});

const facts = analyze(fileURLToPath(new URL("./fixtures/next-app", import.meta.url)));
const grouping = defaultGrouping(facts);
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);

test("route files on one board get told apart in the model, the box labels and the page", () => {
  assert.equal(model.names?.["app/api/hello/route.ts"], "hello/route.ts");
  assert.equal(model.names?.["app/api/users/me/route.ts"], "me/route.ts");
  assert.equal(model.names?.["app/api/users/[id]/route.ts"], "users/[id]/route.ts");
  // a file whose basename is alone in its leaf keeps it
  assert.equal(model.names?.["lib/actions.ts"], undefined);
  const api = Object.values(model.nodes).find((n) => n.files.includes("app/api/hello/route.ts"))!;
  assert.equal(fileBoxLabel(model, api.id, "f:app/api/hello/route.ts").split("\n")[0], "hello/route.ts");

  const page = pageData(renderHtml(model, {}));
  const at = (p: string) => `@${page.paths.indexOf(p)}`;
  assert.equal(page.names[at("app/api/users/me/route.ts")], "me/route.ts");
  assert.equal(Object.keys(page.names).length, Object.keys(model.names!).length);
});

test("flow titles name a file with no route the way its box does, and survive the page's wire format", () => {
  // a route file is named by its route (flows.ts); any other file by its box's name
  const roles = modelRoles({ ...model, names: { ...model.names, "lib/index.ts": "lib/index.ts" } }, facts, "root");
  assert.equal(roles.name("f:lib/index.ts"), "lib/index");
  assert.equal(roles.name("f:app/api/users/me/route.ts"), "/api/users/me");
  const { flows } = resolveFlows(grouping, model, facts);
  const titles = Object.values(flows).flat().map((f) => f.title);
  const page = pageData(renderHtml({ ...model, flows }, {}));
  assert.deepEqual((Object.values(page.flows ?? {}).flat() as { title: string }[]).map((f) => f.title).sort(), titles.sort());
});
