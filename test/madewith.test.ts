import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { FEEDBACK_URL, LANDING_URL, NAME, REPO_URL, brandName, madeWithUrl } from "../src/build/brand.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";

const page = () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/basic-app", import.meta.url)));
  const g = defaultGrouping(facts);
  return renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
};

test("the page carries a 'Made with' and a Feedback link that open in a new tab", () => {
  const html = page();
  const footer = html.match(/<footer class="made">(.*?)<\/footer>/)?.[1];
  assert.ok(footer, "a footer in the panel");
  const links = [...footer.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener">([^<]+)<\/a>/g)].map((m) => [m[1]!.replaceAll("&amp;", "&"), m[2]]);
  assert.equal(links.length, 2);
  assert.equal(links[0]![1], "Made with RepoLadder");
  assert.equal(links[1]![1], "Feedback");
  assert.equal(links[1]![0], FEEDBACK_URL);
});

test("the 'Made with' link carries only ref=diagram, nothing about the repo", () => {
  const html = page();
  const href = html.match(/<footer class="made"><a href="([^"]+)"/)![1]!.replaceAll("&amp;", "&");
  const url = new URL(href);
  assert.deepEqual([...url.searchParams], [["ref", "diagram"]]);
  assert.ok(!href.includes("basic-app"));
});

test("'Made with' points at the landing page, Feedback at the repo", () => {
  const html = page();
  const hrefs = [...html.match(/<footer class="made">(.*?)<\/footer>/)![1]!.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
  const url = new URL(hrefs[0]!);
  assert.equal(url.origin, "https://repoladder.com");
  assert.equal(url.pathname, "/");
  assert.equal(hrefs[0], "https://repoladder.com/?ref=diagram");
  assert.ok(hrefs[1]!.startsWith(REPO_URL + "/"));
  assert.ok(!LANDING_URL.startsWith("https://github.com/"));
  assert.equal(REPO_URL, "https://github.com/repoladder/repoladder");
  assert.equal(FEEDBACK_URL, `${REPO_URL}/issues/new?template=feedback.yml`);
  assert.equal(madeWithUrl(), "https://repoladder.com/?ref=diagram");
});

test("brandName: REPOLADDER_BRAND_NAME overrides NAME for recordings; unset or blank is NAME", () => {
  assert.equal(brandName({}), NAME);
  assert.equal(brandName({ REPOLADDER_BRAND_NAME: "RepoLadder" }), "RepoLadder");
  assert.equal(brandName({ REPOLADDER_BRAND_NAME: "  " }), NAME);
});
