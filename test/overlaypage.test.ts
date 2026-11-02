// A page built with an overlay: the bundle and its install call ride after the viewer, only then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAllPaths } from "../src/analyze/files.ts";
import { buildFromFiles } from "../src/lib.ts";
import { renderHtml } from "../src/build/html.ts";
import type { BoardLayout } from "../src/build/layout.ts";

const dir = (n: string) => fileURLToPath(new URL(`fixtures/${n}`, import.meta.url));
const filesOf = (d: string) => new Map(listAllPaths(d).filter((p) => existsSync(join(d, p))).map((p) => [p, readFileSync(join(d, p), "utf8")] as [string, string]));
import { pageViewer } from "../src/build/filepack.ts";
import { OVERLAY_KB, budgetKb, pageSize } from "../src/build/pagesize.ts";
import { viewerAssets } from "../src/build/viewer.ts";
import { pageData } from "../src/build/filepack.ts";

const deep = filesOf(dir("deep"));
const grouping = JSON.parse(deep.get("grouping.json")!);
const overlay = { changed: ["n:api", "n:nope"], added: ["n:svc-stripe"], addedEdges: ["e:app>svc-stripe"], removedEdges: ["e:api>svc-stripe"], parts: [{ id: "n:api", files: 1 }] };

async function page(o?: typeof overlay) {
  const r = await buildFromFiles(deep, { grouping, overlay: o });
  assert.ok(r.ok);
  return r.html;
}

test("an overlay page ends its viewer script with the install call and carries the bundle and styles", async () => {
  const v = pageViewer(await page(overlay)), assets = viewerAssets();
  assert.ok(v.js.startsWith(assets.js), "the viewer script is unchanged ahead of the bundle");
  assert.ok(v.js.includes(assets.overlay!.js));
  assert.ok(v.js.endsWith("repoladderOverlay.install(" + JSON.stringify({ changed: ["n:api"], added: ["n:svc-stripe"], addedEdges: ["e:app>svc-stripe"], removedEdges: ["e:api>svc-stripe"], parts: [{ id: "api", name: "API server", files: 1 }] }) + ")"));
  assert.ok(v.css.startsWith(assets.css) && v.css.endsWith(assets.overlay!.css));
});

test("without the option the viewer is exactly today's, and undefined is the same as absent", async () => {
  const html = await page(), assets = viewerAssets();
  assert.deepEqual(pageViewer(html), { css: assets.css, js: assets.js });
  assert.ok(!html.includes("repoladderOverlay"));
  assert.equal(html, await page(undefined));
  const plain = await buildFromFiles(deep, { grouping }), undef = await buildFromFiles(deep, { grouping, overlay: undefined });
  assert.ok(plain.ok && undef.ok && plain.html === undef.html);
});

test("the install payload holds only resolved ids", async () => {
  const v = pageViewer(await page(overlay));
  assert.ok(!v.js.includes("n:nope"));
});

test("the page data is the same with and without an overlay", async () => {
  assert.deepEqual(pageData(await page(overlay)), pageData(await page()));
});

test("an overlay page fits its budget, which only an overlay page gets", async () => {
  const html = await page(overlay), boards = Object.keys(pageData(html).boards).length;
  assert.ok(pageSize(html).total / 1024 < budgetKb(boards, true));
  assert.equal(budgetKb(boards, true) - budgetKb(boards), OVERLAY_KB);
});

test("renderHtml without marks is the same page as before the option, and only marks add the bundle", async () => {
  const r = await buildFromFiles(deep, { grouping });
  assert.ok(r.ok);
  const layout: Record<string, BoardLayout> = {};
  for (const [id, b] of Object.entries(r.model.boards)) layout[id] = { n: b.nodes.map((n, i) => [n, i * 100, 0, 80, 40, 0]), e: [] };
  const plain = renderHtml(r.model, layout), assets = viewerAssets();
  assert.equal(plain, renderHtml(r.model, layout, undefined, undefined));
  assert.ok(!plain.includes("repoladderOverlay"));
  assert.deepEqual(pageViewer(plain), { css: assets.css, js: assets.js });
  const marked = renderHtml(r.model, layout, undefined, { changed: ["n:api"], added: [], addedEdges: [], removedEdges: [], parts: [] });
  assert.ok(pageViewer(marked).js.includes("repoladderOverlay.install("));
});
