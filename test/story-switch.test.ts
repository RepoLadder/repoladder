import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { githubSource, gitSha, listAllPaths } from "../src/analyze/files.ts";
import { defaultGrouping } from "../src/model/grouping.ts";
import type { Grouping, Story } from "../src/model/schema.ts";
import { summarize, STORY_OFF_MARKER } from "../src/model/summary.ts";
import { withoutStory } from "../src/build/pipeline.ts";
import { DEFAULT_FEATURES } from "../src/features.ts";
import { buildFromFiles } from "../src/lib.ts";
import { pageData } from "../src/build/filepack.ts";
import { landAt } from "../src/viewer/dialmap.ts";

const dir = fileURLToPath(new URL("./fixtures/multi", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const multi = analyze(dir);
const files = new Map(listAllPaths(dir).filter((p) => existsSync(join(dir, p))).map((p) => [p, readFileSync(join(dir, p), "utf8")] as [string, string]));
const meta = { repo: basename(dir), sha: gitSha(dir), github: githubSource(dir) };

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

async function build(grouping: Grouping, features?: { story: boolean }) {
  const r = await buildFromFiles(files, { ...meta, grouping, ...(features ? { features: { ...DEFAULT_FEATURES, ...features } } : {}) });
  return r;
}

test("story off by default: the grouping's story is dropped from model and page", async () => {
  const r = await build(withStory(story()));
  assert.ok(r.ok);
  assert.equal(r.model.story, undefined);
  const data = pageData(r.html) as Record<string, any>;
  assert.equal("story" in data, false);
  assert.equal("_story" in data.boards, false);
  assert.equal("_story" in data.layout, false);
});

test("story on: the page has the story board", async () => {
  const r = await build(withStory(story()), { story: true });
  assert.ok(r.ok);
  assert.ok(r.model.story);
  const data = pageData(r.html) as Record<string, any>;
  assert.ok(data.story.actors);
  assert.ok(data.boards._story);
  assert.ok(data.layout._story);
});

test("an invalid story builds while off and fails on", async () => {
  const s = story();
  s.uses[0].actor = "nobody";
  assert.ok((await build(withStory(s))).ok);
  await assert.rejects(build(withStory(s), { story: true }), (e: any) => e.code === "INVALID_GROUPING");
});

test("a grouping without a story builds the same model with the switch on or off", async () => {
  const g = defaultGrouping(multi);
  const off = await build(g), on = await build(g, { story: true });
  assert.ok(off.ok && on.ok);
  assert.equal(JSON.stringify(off.model), JSON.stringify(on.model));
});

test("withoutStory keeps the object when there is no story", () => {
  const g = defaultGrouping(multi);
  assert.equal(withoutStory(g), g);
  assert.equal("story" in withoutStory(withStory(story())), false);
});

test("a stored _story board lands on the overview on a story-less page", () => {
  assert.equal(landAt("_story", false), "root");
});

test("digest: story off has the marker and no entry points; on is the entry-points digest", () => {
  const off = summarize(multi);
  assert.ok(off.includes(STORY_OFF_MARKER));
  assert.doesNotMatch(off, /## Likely entry points/);
  const on = summarize(multi, undefined, { ...DEFAULT_FEATURES, story: true });
  assert.ok(!on.includes(STORY_OFF_MARKER));
  assert.match(on, /## Likely entry points/);
});

test("the map skill keys on the digest marker", () => {
  const skill = readFileSync(fileURLToPath(new URL("../plugin/skills/map/SKILL.md", import.meta.url)), "utf8");
  assert.ok(skill.includes(STORY_OFF_MARKER));
});

test("CLI: no flag drops the story, REPOLADDER_STORY=1 and --story keep it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cw-story-"));
  const gfile = join(tmp, "grouping.json");
  writeFileSync(gfile, JSON.stringify(withStory(story())));
  const run = (env: Record<string, string>, ...extra: string[]) => {
    const out = mkdtempSync(join(tmpdir(), "cw-story-out-"));
    execFileSync(process.execPath, [cli, "build", dir, "--fresh", "--grouping", gfile, ...extra, "--out", out], { env: { ...process.env, DO_NOT_TRACK: "1", ...env }, stdio: "pipe" });
    return JSON.parse(readFileSync(join(out, "model.json"), "utf8"));
  };
  assert.equal(run({}).story, undefined);
  assert.ok(run({ REPOLADDER_STORY: "1" }).story);
  assert.ok(run({}, "--story").story);
  const sum = (env: Record<string, string>) => execFileSync(process.execPath, [cli, "summary", dir, "--fresh"], { env: { ...process.env, DO_NOT_TRACK: "1", ...env }, stdio: "pipe" }).toString();
  assert.ok(sum({}).includes(STORY_OFF_MARKER));
  assert.match(sum({ REPOLADDER_STORY: "1" }), /## Likely entry points/);
});
