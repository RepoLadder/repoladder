// The engine version (#366): one source, stamped into every page as a generator tag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { PACKAGE, VERSION } from "../src/version.ts";
import { SEMVER } from "../scripts/npm-package.ts";

const json = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("VERSION is the root package.json version", () => {
  assert.equal(VERSION, json("../package.json").version);
  assert.match(VERSION, SEMVER);
});

test("plugin.json's version does not drift from the engine version", () => {
  const f = new URL("../plugin/.claude-plugin/plugin.json", import.meta.url);
  // skipped when the field is gone (the rename may drop it)
  if (!existsSync(f) || !json("../plugin/.claude-plugin/plugin.json").version) return;
  assert.equal(json("../plugin/.claude-plugin/plugin.json").version, VERSION);
});

test("every page carries one generator tag between the charset and the title", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  const g = defaultGrouping(facts);
  const html = renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
  const tag = `<meta name="generator" content="${PACKAGE}@${VERSION}">`;
  assert.equal(count(html, /<meta name="generator"/g), 1);
  assert.ok(html.includes(tag));
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf(tag));
  assert.ok(html.indexOf(tag) < html.indexOf("<title>"));
});
