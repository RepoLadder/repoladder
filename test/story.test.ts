import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Story } from "../src/model/schema.ts";
import { storyRefs } from "../src/model/story.ts";
import { summarize } from "../src/model/summary.ts";
import { DEFAULT_FEATURES } from "../src/features.ts";

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));

const story = (): Story => ({
  actors: [
    { id: "customer", name: "Customer", summary: "Uses the app.", kind: "person" },
    { id: "cron", name: "Health check", summary: "Pings the server.", kind: "system" },
  ],
  uses: [
    { actor: "customer", part: "web", says: "opens the app", entry: "web/src/main.ts" },
    { actor: "cron", part: "functions", says: "checks it is up", entry: "pingHttp" },
    { actor: "customer", part: "functions", says: "looks up users", entry: "/users/:id" },
  ],
  narrative: ["A [[customer]] opens the [[web|web app]], which calls the [[functions]].", "Payments go through [[svc-stripe]]."],
});
const withStory = (s: Story): Grouping => ({ ...defaultGrouping(multi), story: s });
const errorsOf = (s: Story) => assign(withStory(s), multi).errors.join("\n");

test("story: a valid story passes and builds a level-0 board", () => {
  const g = Grouping.parse(withStory(story()));
  const a = assign(g, multi);
  assert.deepEqual(a.errors, []);
  const m = buildModel(multi, g, a.leafOf);
  const b = m.story!.board;
  assert.deepEqual(b.nodes, ["customer", "cron", ...m.boards.root.nodes]);
  const e = (x: string, y: string) => b.edges.find((z) => z.a === x && z.b === y);
  assert.deepEqual(e("customer", "web")?.says, ["opens the app"]);
  assert.deepEqual(e("customer", "web")?.ev, [["web/src/main.ts", 1, "web/src/main.ts"]]);
  assert.equal(e("cron", "functions")?.ev[0][0], "functions/src/index.ts");
  assert.match(e("cron", "functions")!.ev[0][2], /pingHttp \(http endpoint\)/);
  // the root's major code edges are carried up
  assert.equal(e("web", "functions")?.calls, 3);
  assert.ok(b.edges.every((x) => x.major));
  assert.deepEqual(Object.keys(m.story!.actors), ["customer", "cron"]);
  // root board and grouping without a story are unchanged
  const plain = buildModel(multi, defaultGrouping(multi), a.leafOf);
  assert.equal(plain.story, undefined);
  assert.equal(JSON.stringify(plain.boards), JSON.stringify(m.boards));
});

test("story: unknown actor fails", () => {
  const s = story();
  s.uses[0].actor = "nobody";
  assert.match(errorsOf(s), /story\.uses\[0\]: unknown actor "nobody"/);
});

test("story: unknown part fails, including a deeper group", () => {
  const s = story();
  s.uses[0].part = "nope";
  assert.match(errorsOf(s), /story\.uses\[0\]: unknown part "nope"/);
  const g: Grouping = {
    version: 1, summary: "",
    children: [
      { id: "client", name: "Client", summary: "", children: [
        { id: "client-api", name: "API", summary: "", files: ["web/src/api.ts"] },
        { id: "client-core", name: "Core", summary: "", files: ["web/**"] },
      ] },
      { id: "rest", name: "Rest", summary: "", files: ["**"] },
    ],
    story: { actors: [story().actors[0]], uses: [{ actor: "customer", part: "client-api", says: "calls", entry: "web/src/api.ts" }], narrative: ["x"] },
  };
  assert.match(assign(g, multi).errors.join("\n"), /unknown part "client-api" \(it is a deeper group/);
});

test("story: an entry not in the facts fails; one in another part fails", () => {
  const s = story();
  s.uses[0].entry = "web/src/login.ts";
  s.uses[1].entry = "web/src/main.ts";
  const err = errorsOf(s);
  assert.match(err, /story\.uses\[0\]: entry "web\/src\/login\.ts" is not a source file path, page route or endpoint name/);
  assert.match(err, /story\.uses\[1\]: entry "web\/src\/main\.ts" is in web, not in part "functions"/);
});

test("story: narrative references and actor ids are checked", () => {
  const s = story();
  s.narrative = ["The [[ghost]] haunts it.", "Broken [[web link."];
  s.actors.push({ id: "web", name: "Clash", summary: "", kind: "person" });
  const err = errorsOf(s);
  assert.match(err, /narrative\[0\]: unknown reference \[\[ghost\]\]/);
  assert.match(err, /narrative\[1\]: malformed reference/);
  assert.match(err, /actor id "web" clashes/);
  assert.equal(Grouping.safeParse(withStory({ ...story(), narrative: Array(7).fill("x") })).success, false);
  assert.equal(Grouping.safeParse(withStory({ ...story(), actors: [{ ...story().actors[0], kind: "robot" as "person" }] })).success, false);
});

test("story: inline reference syntax", () => {
  assert.deepEqual(storyRefs("A [[customer]] uses [[web-app|the site]]."), [
    { id: "customer", text: null, index: 2, length: 12 },
    { id: "web-app", text: "the site", index: 20, length: 20 },
  ]);
  assert.deepEqual(storyRefs("no refs, [single] or {braces}"), []);
});

test("digest lists likely entry points", () => {
  const d = summarize(multi, undefined, { ...DEFAULT_FEATURES, story: true });
  assert.match(d, /## Likely entry points/);
  assert.match(d, /Callable functions: ping\n/);
  assert.match(d, /HTTP routes: \/users\/:id, api, pingHttp/);
  assert.match(d, /App entry files: web\/src\/main\.ts/);
});

test("story: a page route is a valid entry, checked against its page's part", () => {
  const facts = { ...multi, pages: [{ route: "/home", file: "web/src/main.ts", from: "web/src/main.ts", line: 1 }] };
  const s = story();
  s.uses[0].entry = "/home";
  const g = withStory(s);
  const a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  const e = buildModel(facts, g, a.leafOf).story!.board.edges.find((x) => x.a === "customer" && x.b === "web");
  assert.deepEqual(e?.ev, [["web/src/main.ts", 1, "/home (page)"]]);
  s.uses[1].entry = "/home";
  assert.match(assign(withStory(s), facts).errors.join("\n"), /entry "\/home" is in web, not in part "functions"/);
});
