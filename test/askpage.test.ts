// The Ask bar is delivered only by the server: the served page carries it once, and nothing else holds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { askAssets, viewerAssets } from "../src/build/viewer.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { startServer, type Running } from "../src/serve/index.ts";

// A deliberate cap on the served-only bundle (minified JS, bytes): raise it only on purpose.
const ASK_JS_CAP = 25 * 1024;

const html = () => {
  const facts = analyze(fileURLToPath(new URL("fixtures/multi", import.meta.url)));
  const g = defaultGrouping(facts);
  return renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
};
const root = fileURLToPath(new URL("fixtures/basic-app", import.meta.url));
const fetchPage = (s: Running) => new Promise<string>((resolve, reject) => {
  get({ host: "127.0.0.1", port: s.port, path: "/", headers: { "x-repoladder-token": s.token } }, (res) => {
    let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve(b));
  }).on("error", reject);
});
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("the served page carries exactly one Ask style and script; the file on disk is unchanged", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rl-askpage-"));
  const file = join(dir, "diagram.html"), page = html();
  writeFileSync(file, page);
  const s = await startServer({ page: () => readFileSync(file), ask: { root, out: dir } });
  t.after(() => s.close());
  const served = await fetchPage(s);
  assert.ok(served.startsWith(page));
  assert.equal(count(served, "repoladderAsk.start()"), 1);
  assert.equal(count(served.slice(page.length), "<style>"), 1);
  assert.equal(count(served.slice(page.length), "<script>"), 1);
  assert.equal(readFileSync(file, "utf8"), page);
});

test("with --no-ask the served page is the file as it is", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rl-askpage-"));
  const page = html();
  const s = await startServer({ page: () => page, ask: false });
  t.after(() => s.close());
  assert.equal(await fetchPage(s), page);
});

test("the Ask bundle closes no tag early and stays under its size cap", () => {
  const a = askAssets();
  assert.ok(!/<\/script/i.test(a.js) && !/<\/style/i.test(a.css));
  assert.ok(a.js.length < ASK_JS_CAP, `${a.js.length} bytes against a cap of ${ASK_JS_CAP}`);
  assert.ok(a.js.includes("/api/ask"));
});

test("published pages and the viewer bundle hold no Ask code", () => {
  const page = html(), v = viewerAssets();
  for (const text of [page, v.js, v.css]) {
    assert.ok(!text.includes("repoladderAsk"));
    assert.ok(!text.includes("/api/ask"));
    assert.ok(!text.includes("x-repoladder-token"));
  }
  const main = readFileSync(new URL("../src/viewer/main.ts", import.meta.url), "utf8");
  assert.ok(!/from "\.\/ask\//.test(main) && !/ask\.css/.test(main));
});
