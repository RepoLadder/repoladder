// Hostile repo names through a full build (#365): directory, file, collection and repo names carrying
// markup, script breaks (the analyzer splits collection names at "/", so `</script>` itself rides in a file path), U+2028 and a very long string must reach the page as data and never as markup.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { pageData, pageParts } from "../src/build/filepack.ts";
import { inlineJson, renderHtml } from "../src/build/html.ts";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { decode91, encode91 } from "../src/viewer/base91.ts";
import { esc } from "../src/viewer/esc.ts";
import { st } from "../src/viewer/state.ts";
import { draw } from "../src/viewer/draw.ts";
import { connList, snippet } from "../src/viewer/panels.ts";
import { fileRef } from "../src/viewer/codelink.ts";
import { idRow } from "../src/viewer/idchip.ts";
import { tourList } from "../src/viewer/walk.ts";
import { renderCollection, renderStoreOverview } from "../src/viewer/collections.ts";
import { renderFile } from "../src/viewer/files.ts";
import { isFile } from "../src/viewer/state.ts";
import { renderEdge, renderNode, renderOverview, renderService } from "../src/viewer/panels.ts";

const win = process.platform === "win32";
const LONG = "L".repeat(5000);
const HOSTILE_COLLECTIONS = ["<img src=x onerror=alert(2)>", "\"><script>alert(3)<", "line\u2028break", LONG];
const FS_NAMES = ["'><svg onload=alert(1)>", "<img src=x onerror=alert(1)>.ts", "x<"];

const root = mkdtempSync(join(tmpdir(), "hostile-'\"<b>-"));
after(() => rmSync(root, { recursive: true, force: true }));

function fixture(): void {
  cpSync(fileURLToPath(new URL("./fixtures/stores", import.meta.url)), root, { recursive: true });
  const src = join(root, "functions", "src");
  const imports: string[] = [];
  if (!win) {
    mkdirSync(join(src, FS_NAMES[0]));
    writeFileSync(join(src, FS_NAMES[0], "a.ts"), `import { sync } from "../admin";\nexport const a = sync;\n`);
    imports.push(`./${FS_NAMES[0]}/a`);
    writeFileSync(join(src, FS_NAMES[1]), `export const b = 1;\n`);
    imports.push(`./${FS_NAMES[1].replace(/\.ts$/, "")}`);
    mkdirSync(join(src, FS_NAMES[2]));
    writeFileSync(join(src, FS_NAMES[2], "script>y.ts"), `export const c = 1;\n`);
    imports.push(`./${FS_NAMES[2]}/script>y`);
  }
  writeFileSync(join(src, "evil.ts"), `import * as admin from "firebase-admin";\nconst db = admin.firestore();\n${HOSTILE_COLLECTIONS.map((c, i) => `export const c${i} = () => db.collection(${JSON.stringify(c)}).doc("x").get();`).join("\n")}\n`);
  imports.push("./evil");
  appendFileSync(join(src, "admin.ts"), `\n${imports.map((i) => `import ${JSON.stringify(i)};`).join("\n")}\n`);
}
fixture();

const fake = (model: Model) => {
  const layout: Record<string, BoardLayout> = {};
  for (const [id, b] of Object.entries(model.boards)) layout[id] = { n: b.nodes.map((n, i) => [n, i * 100, 0, 80, 40, 0]), e: b.edges.map((e, i) => [e.a, e.b, e.major ? 1 : 0, 3 * i, 7, 3 * i + 40, 90, 5, 260]) };
  return layout;
};
const model = (): Model => {
  const facts = analyze(root);
  const g = defaultGrouping(facts);
  return buildModel(facts, g, assign(g, facts).leafOf);
};

const m = model();
const html = renderHtml(m, fake(m));
const data = pageData(html);
const everything = JSON.stringify(data);
const real = pageData(renderHtml(m, await layoutBoards(m)));
const hostile = [...HOSTILE_COLLECTIONS, ...(win ? [] : FS_NAMES), m.repo];
// a raw tag or an event-handler attribute (escaped text such as `&lt;img src=x onerror=…` is fine)
const raw = /<(img|script)|<svg onload|<[^<>]*\son(error|load)=/i;

test("the helper escapes every special character and escapes entities again", () => {
  for (const [c, e] of [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"], ["`", "&#96;"]]) assert.equal(esc(c), e);
  assert.equal(esc("&amp;"), "&amp;amp;");
});

test("src defines exactly one HTML escaper", () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const defs = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && /(const|function)\s+esc\b/.test(readFileSync(join(src, f), "utf8")));
  assert.deepEqual(defs.map((f) => f.replaceAll("\\", "/")), ["viewer/esc.ts"]);
});

test("inlineJson keeps < and line separators out of the script and round-trips", () => {
  const s = "a</script><!--\u2028\u2029";
  const j = inlineJson(s);
  assert.doesNotMatch(j, /[<\u2028\u2029]/);
  assert.equal(JSON.parse(j), s);
  const b = encode91(new Uint8Array(randomBytes(4096)));
  assert.equal(inlineJson(b), JSON.stringify(b));
});

test("hostile names reach the page data verbatim", () => {
  assert.equal(data.repo, m.repo);
  if (!win) assert.ok(data.paths.some((p: string) => p.includes("x</script>y.ts")));
  for (const h of [...HOSTILE_COLLECTIONS, ...(win ? [] : ["<img src=x onerror=alert(1)>.ts", "'><svg onload=alert(1)>", "script>y.ts"])]) {
    assert.ok(everything.includes(JSON.stringify(h).slice(1, -1)) || everything.includes(h), `missing ${h.slice(0, 30)}`);
  }
});

test("the page shell holds none of them as markup", () => {
  assert.equal(html.split("<script>").length, 2);
  assert.equal(html.split("</script>").length, 2);
  assert.doesNotThrow(() => pageParts(html));
  const shell = html.slice(0, html.indexOf("<script>")) + html.slice(html.indexOf("</script>"));
  assert.doesNotMatch(shell, /<img|<svg onload|onerror=|onload=/);
  for (const h of hostile) assert.ok(!shell.includes(h), h.slice(0, 30));
  assert.ok(shell.includes(`<title>${esc(m.repo)} architecture</title>`));
  assert.ok(shell.includes(`<h1>${esc(m.repo)}</h1>`));
});

test("the viewer's HTML builders escape hostile names", () => {
  st.data = real;
  const data = real;
  const check = (out: string, what: string) => {
    assert.doesNotMatch(out.replace(/"[^"]*"/g, '""'), raw, what); // quoted attribute values are inert once escaped
    for (const h of hostile) if (h !== esc(h) && h.length >= 6 && h.length < 100) assert.ok(!out.includes(h), `${what}: ${h}`);
  };
  for (const id of Object.keys(data.layout)) {
    st.cur = id;
    check(draw(data.layout[id]), `draw ${id}`);
    check(connList(data.boards[id].nodes[0] ?? id), `connList ${id}`);
    try { check(tourList(), "tourList"); } catch (e) { if (!(e instanceof TypeError)) throw e; } // needs a drawn board: the visual tier covers it
    for (const n of data.boards[id].nodes) check(idRow(n), `idRow ${n}`);
    for (const e of data.boards[id].edges) for (const [f, l] of e.ev) check(fileRef(f, l) + snippet(f, l), `evidence ${id}`);
  }
});

test("the viewer's panels escape hostile names", () => {
  st.data = real;
  const el = { innerHTML: "" };
  const g = globalThis as any;
  g.document = { getElementById: () => el, querySelector: () => null, querySelectorAll: () => [] };
  g.matchMedia = () => ({ matches: false });
  try {
    for (const id of Object.keys(real.layout)) {
      st.cur = id;
      const b = real.boards[id];
      const calls: (() => void)[] = [renderOverview, ...b.nodes.map((n: string) => () => (n.startsWith("c:") ? renderCollection(n) : real.services[n] ? renderService(n) : isFile(n) ? renderFile(n, connList(n)) : renderNode(n))), ...b.edges.map((e: any) => () => renderEdge(e.a, e.b))];
      if (id.startsWith("store-")) calls.push(renderStoreOverview);
      for (const f of calls) {
        el.innerHTML = "";
        try { f(); } catch (e) { if (!(e instanceof TypeError)) throw e; continue; } // needs more DOM than the stub: the visual tier covers it
        assert.doesNotMatch(el.innerHTML.replace(/"[^"]*"/g, '""'), raw, `panel on ${id}`);
        for (const h of hostile) if (h !== esc(h) && h.length >= 6 && h.length < 100) assert.ok(!el.innerHTML.includes(h), `panel on ${id}: ${h}`);
      }
    }
  } finally {
    delete g.document;
    delete g.matchMedia;
  }
});

test("the GitHub link needs a sane repo and sha, and encodes every segment", () => {
  const gh = (github: Model["github"]) => pageData(renderHtml({ ...m, github }, fake(m))).gh;
  assert.equal(gh({ repo: 'a"b/c<d', sha: "abc1234", dir: "" }), undefined);
  assert.equal(gh({ repo: "owner/repo", sha: "javascript:x", dir: "" }), undefined);
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(gh({ repo: "owner/my.repo-1", sha, dir: "packages/a b/" }), `https://github.com/owner/my.repo-1/blob/${sha}/packages/a%20b/`);
});

void decode91;
