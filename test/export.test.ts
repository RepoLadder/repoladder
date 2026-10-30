import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { boardSvg, boardTitle, fileNames } from "../src/build/export.ts";
import type { BoardLayout } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { MORE, baseName, filePath, isFileId } from "../src/model/fileboards.ts";
import { THEMES } from "../src/viewer/theme.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const grouping = defaultGrouping(facts);
const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);

// A stand-in for D2: nodes in a row, straight edges between their centres. Enough to check drawing.
function gridLayout(boardId: string): BoardLayout {
  const b = model.boards[boardId];
  const n: BoardLayout["n"] = b.nodes.map((id, i) => [id, i * 200, 0, 160, 60, model.services[id] ? 1 : 0]);
  const at = new Map(n.map(([id, x]) => [id, x + 80]));
  const e: BoardLayout["e"] = b.edges.filter((x) => x.major).map((x) => [x.a, x.b, 0, at.get(x.a)!, 60, at.get(x.a)!, 100, at.get(x.b)!, 100, at.get(x.b)!, 60]);
  return { n, e };
}

test("exported boards are standalone SVG with every box and arrow", () => {
  for (const id of Object.keys(model.boards)) {
    const layout = gridLayout(id);
    const svg = boardSvg(model, id, layout, "light");
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+" width="\d+" height="\d+"/);
    // No viewer tokens or scripts: the file has to render as an <img> on GitHub.
    assert.ok(!svg.includes("var(--") && !svg.includes("<script"));
    // exports render in system fonts: the page's embedded families aren't there to name
    assert.ok(!svg.includes("Geist") && svg.includes("ui-sans-serif") && svg.includes("ui-monospace"), "system font stacks only");
    assert.equal(svg.match(/<g class="node/g)?.length ?? 0, layout.n.length);
    assert.equal(svg.match(/<g class="wire/g)?.length ?? 0, layout.e.length);
    // file boxes on leaf boards are named by their file name
    const nameOf = (nid: string) => model.services[nid] ?? model.nodes[nid]?.name ?? (isFileId(nid) && nid !== MORE ? baseName(filePath(nid)) : nid);
    for (const [nid] of layout.n) if (nid !== MORE) assert.ok(svg.includes(`>${nameOf(nid)}</text>`), nid);
    assert.equal(svg, boardSvg(model, id, layout, "light"), "deterministic");
  }
});

test("themes swap colors, and names are escaped", () => {
  const light = boardSvg(model, "root", gridLayout("root"), "light"), dark = boardSvg(model, "root", gridLayout("root"), "dark");
  assert.ok(light.includes(THEMES.light.surface) && !light.includes(THEMES.dark.surface));
  assert.ok(dark.includes(THEMES.dark.surface) && !dark.includes(THEMES.light.surface));
  const m = structuredClone(model);
  m.repo = `a<b>&"c"`;
  const svg = boardSvg(m, "root", gridLayout("root"));
  assert.ok(svg.includes("a&lt;b&gt;&amp;&quot;c&quot;") && !svg.includes("a<b>"));
});

test("titles follow the board path and file names are safe and unique", () => {
  const child = model.nodes.root.children[0];
  assert.equal(boardTitle(model, "root"), `${model.repo} · Overview`);
  assert.equal(boardTitle(model, child), `${model.repo} · Overview › ${model.nodes[child].name}`);
  assert.deepEqual(fileNames(["root", "web/app", "web app", "../x", ""]), ["root", "web_app", "web_app-2", "x", "board"]);
});
