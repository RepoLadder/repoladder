// The story level in the page: D2 source, page data, deep links and the narrative helpers (#13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Story } from "../src/model/schema.ts";
import { d2Source, layoutBoards } from "../src/build/layout.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData as readPage } from "../src/build/filepack.ts";
import { hashFor, parseHash } from "../src/viewer/deeplink.ts";
import { STORY, st, type ViewerData } from "../src/viewer/state.ts";
import { boxOf, litBy, sentenceHtml } from "../src/viewer/story.ts";

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const story: Story = {
  actors: [
    { id: "customer", name: "Customer", summary: "Uses the app.", kind: "person" },
    { id: "cron", name: "Health check", summary: "Pings the server.", kind: "system" },
  ],
  uses: [
    { actor: "customer", part: "web", says: "opens the app", entry: "web/src/main.ts" },
    { actor: "cron", part: "functions", says: "checks it is up", entry: "pingHttp" },
  ],
  narrative: ["A [[customer]] opens the [[web|web app]].", "A [[cron]] keeps watch.", "The [[customer]] and the [[functions]]."],
};
const g = Grouping.parse({ ...defaultGrouping(multi), story });
const model = buildModel(multi, g, assign(g, multi).leafOf);

test("story level: D2 source sizes actors and reserves no room for arrow labels", () => {
  const src = d2Source(model, STORY);
  assert.match(src, /"story-actors"\."customer": "" \{ width: \d+; height: \d+ \}/);
  assert.match(src, /^"story-actors"\."customer" -> "web"$/m);
  // what actors do sits in the lane beside them (storylayout.ts); code arrows carry no labels here
  for (const line of src.split("\n").filter((l) => l.includes("->"))) assert.ok(!line.includes(":"), line);
});

test("story level: laid out and shipped in the page data as one more board", async () => {
  const layout = await layoutBoards(model);
  assert.deepEqual(layout[STORY].n.map((n) => n[0]).sort(), [...model.story!.board.nodes].sort());
  const html = renderHtml(model, layout);
  const data: ViewerData = readPage(html);
  assert.deepEqual(Object.keys(data.story!.actors), ["customer", "cron"]);
  assert.equal(data.story!.narrative.length, 3);
  assert.ok(data.boards[STORY].edges.some((e) => e.a === "customer" && e.says?.[0] === "opens the app"));
  // without a story nothing changes
  const plain = buildModel(multi, defaultGrouping(multi), assign(defaultGrouping(multi), multi).leafOf);
  const pd: ViewerData = readPage(renderHtml(plain, {}));
  assert.equal(pd.story, undefined);
  assert.ok(!pd.boards[STORY]);
});

const lay = (ids: string[]) => ({ n: ids.map((id) => [id, 0, 0, 1, 1, 0]), e: [] }) as unknown as ViewerData["layout"][string];
function storyPage(): ViewerData {
  const html = renderHtml(model, Object.fromEntries([STORY, ...Object.keys(model.boards)].map((id) => [id, lay(id === STORY ? model.story!.board.nodes : model.boards[id].nodes)])));
  return readPage(html);
}

test("story level: the empty hash is the story; actors and level-1 parts link to it", () => {
  const d = storyPage();
  assert.equal(hashFor(d, STORY, null), "");
  assert.equal(hashFor(d, "root", null), "root~");
  assert.deepEqual(parseHash(d, "#customer"), { board: STORY, hit: "n:customer" });
  assert.deepEqual(parseHash(d, "#web"), { board: STORY, hit: "n:web" });
  assert.deepEqual(parseHash(d, "#customer.web"), { board: STORY, hit: "e:customer>web" });
});

test("story level: sentences light what they name, and an actor's arrows when they name none of its parts", () => {
  st.data = storyPage();
  st.cur = STORY;
  const edges = st.data.boards[STORY].edges;
  const one = litBy(story.narrative[0], edges);
  assert.deepEqual([...one.boxes].sort(), ["customer", "web"]);
  assert.ok(one.edges.has("customer>web"));
  const two = litBy(story.narrative[1], edges);
  assert.deepEqual([...two.boxes].sort(), ["cron", "functions"]);
  assert.ok(two.edges.has("cron>functions"));
  // a sentence naming a deeper group lights its level-1 part
  const deep = model.nodes.web.children[0];
  if (deep) assert.equal(boxOf(deep), "web");
  const html = sentenceHtml(story.narrative[0], true);
  assert.match(html, /A <button class="ref r-actor" data-sel="n:customer">customer<\/button> opens the <button class="ref r-\w+" data-sel="n:web">web app<\/button>\./);
});
