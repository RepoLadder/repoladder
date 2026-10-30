// Inspector links to GitHub (#426): file and folder hrefs, the shared folder of a part, and the panels that use them.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { codeHref, commonDir, fileRef, folderLink, pathLink } from "../src/viewer/codelink.ts";
import { renderFile } from "../src/viewer/files.ts";
import { renderNode } from "../src/viewer/panels.ts";
import { st } from "../src/viewer/state.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";
const GH = `https://github.com/o/r/blob/${sha}/`;
const g = globalThis as any;
const el = { innerHTML: "" };

const leaf = (files: string[]) => ({ name: "Leaf", summary: "", count: files.length, loc: 10, files, children: [], kind: "part" });
function setup(paths: string[], gh: string | undefined, nodes: Record<string, any> = {}) {
  st.data = { repo: "r", sha, paths, nodes, services: {}, boards: { root: { nodes: [], edges: [], context: [], hubs: [], throughout: [] } }, layout: {}, files: { "@0": [5] }, ...(gh ? { gh } : {}) } as any;
  st.cur = "root";
  g.document = { getElementById: () => el, addEventListener() {} };
  g.matchMedia = () => ({ matches: false });
  el.innerHTML = "";
}
afterEach(() => { delete g.document; delete g.matchMedia; });

test("codeHref: blob or tree, line, encoding, monorepo dir, no gh", () => {
  setup(["a"], `${GH}apps/my web/`.replace("my web", "my%20web"));
  assert.equal(codeHref("src/a b/#x?.ts"), `${GH}apps/my%20web/src/a%20b/%23x%3F.ts`);
  assert.equal(codeHref("src/é.ts", 7), `${GH}apps/my%20web/src/%C3%A9.ts#L7`);
  assert.equal(codeHref("src", undefined, true), `https://github.com/o/r/tree/${sha}/apps/my%20web/src`);
  setup(["a"], `https://github.com/blob/blob/blob/${sha}/`);
  assert.equal(codeHref("x", undefined, true), `https://github.com/blob/blob/tree/${sha}/x`);
  setup(["a"], undefined);
  assert.equal(codeHref("x"), undefined);
});

test("commonDir keeps whole segments only", () => {
  assert.equal(commonDir(["src/a/x.ts", "src/a/b/y.ts"]), "src/a");
  assert.equal(commonDir(["src/a-b/x.ts", "src/a/y.ts"]), "src");
  assert.equal(commonDir(["a/x.ts", "b/y.ts"]), "");
  assert.equal(commonDir(["x.ts", "src/y.ts"]), "");
  assert.equal(commonDir(["x.ts"]), "");
  assert.equal(commonDir([]), "");
  assert.equal(commonDir(["src/a/x.ts"]), "src/a");
});

test("folderLink links the shared folder, never the root, and only with gh", () => {
  setup(["a"], GH);
  const out = folderLink(["src/a/x.ts", "src/a/y.ts"]);
  assert.match(out, new RegExp(`href="https://github.com/o/r/tree/${sha}/src/a" target="_blank" rel="noopener">src/a/</a>`));
  assert.equal(folderLink(["a/x.ts", "b/y.ts"]), "");
  assert.equal(folderLink(["x.ts"]), "");
  setup(["a"], undefined);
  assert.equal(folderLink(["src/a/x.ts"]), "");
});

test("fileRef and pathLink", () => {
  setup(["src/a.ts"], GH);
  assert.equal(fileRef(0, 3), `<a class="code mono" href="${GH}src/a.ts#L3" target="_blank" rel="noopener">src/a.ts<span>:3</span></a>`);
  assert.equal(fileRef(0), pathLink("src/a.ts"));
  setup(["src/a.ts"], undefined);
  assert.equal(fileRef(0, 3), "src/a.ts<span>:3</span>");
  assert.equal(pathLink("src/a.ts"), "src/a.ts");
});

test("file box and +more panels link their paths; without gh there is no anchor", () => {
  setup(["src/a.ts"], GH, { root: leaf(["src/a.ts"]) });
  renderFile("@0", "");
  assert.ok(el.innerHTML.includes(`<a class="code mono" href="${GH}src/a.ts" target="_blank" rel="noopener">src/a.ts</a>`));
  setup(["src/a.ts", "src/b.ts"], GH, { root: leaf(["src/a.ts", "src/b.ts"]) });
  st.data.boards.root.nodes = ["@0"];
  renderFile("+more", "");
  assert.ok(el.innerHTML.includes(`href="${GH}src/b.ts"`));
  assert.ok(!el.innerHTML.includes(`href="${GH}src/a.ts"`));
  setup(["src/a.ts"], undefined, { root: leaf(["src/a.ts"]) });
  renderFile("@0", "");
  assert.ok(!el.innerHTML.includes("<a"));
});

test("part panels: Folder link on a leaf and a group, none when files do not share one", () => {
  const nodes = { l1: leaf(["src/a/x.ts", "src/a/y.ts"]), l2: leaf(["src/a/b/z.ts"]), l3: leaf(["lib/q.ts"]), g1: { ...leaf([]), children: ["l1", "l2"] }, g2: { ...leaf([]), children: ["l1", "l3"] } };
  setup(["src/a/x.ts"], GH, nodes);
  renderNode("l1");
  assert.ok(el.innerHTML.includes(`Folder: <a class="code mono" href="https://github.com/o/r/tree/${sha}/src/a"`));
  renderNode("g1");
  assert.ok(el.innerHTML.includes(`/tree/${sha}/src/a"`));
  renderNode("g2");
  assert.ok(!el.innerHTML.includes("Folder:"));
  setup(["src/a/x.ts"], undefined, nodes);
  renderNode("l1");
  assert.ok(!el.innerHTML.includes("Folder:"));
});

test("hostile file names are escaped in file and folder links", () => {
  const bad = `src/"><b>&\`'/x.ts`;
  setup([bad], GH, { root: leaf([bad]) });
  renderFile("@0", "");
  assert.ok(!el.innerHTML.includes("<b>"));
  renderNode("root");
  assert.ok(!el.innerHTML.includes("<b>"));
  assert.ok(el.innerHTML.includes("Folder:"));
});
