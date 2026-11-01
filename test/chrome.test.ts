import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { madeWithUrl } from "../src/build/brand.ts";
import { renderHtml } from "../src/build/html.ts";
import { viewerAssets } from "../src/build/viewer.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { tokenCss } from "../src/viewer/theme.ts";

const page = () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  const g = defaultGrouping(facts);
  return renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
};
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("the header keeps its one-line shell and carries one brand link before the title", () => {
  const html = page();
  assert.equal(count(html, /^<header class="topbar">$/gm), 1);
  assert.equal(count(html, /^<\/header>$/gm), 1);
  assert.equal(count(html, /<title>[\s\S]*?<\/title>/g), 1);
  const head = html.slice(html.indexOf("<header "), html.indexOf("</header>"));
  const links = head.match(/<a class="brand"[^>]*>/g) ?? [];
  assert.equal(links.length, 1);
  assert.ok(head.indexOf("<a class=\"brand\"") < head.indexOf("<h1>"));
  assert.ok(links[0]!.includes(`href="${madeWithUrl().replaceAll("&", "&amp;")}"`) && links[0]!.includes('target="_blank" rel="noopener"') && links[0]!.includes('aria-label="RepoLadder"') && links[0]!.includes('title="RepoLadder"'));
  assert.equal(count(head, /<svg class='mk mk-l'/g), 1);
  assert.equal(count(head, /<svg class='mk mk-d'/g), 1);
  assert.equal(count(head, /aria-hidden='true'/g), 2);
});

test("every id in the page is unique", () => {
  const ids = [...page().matchAll(/\bid=(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]);
  assert.equal(new Set(ids).size, ids.length);
});

test("the footer is unchanged: one made-with footer with two links", () => {
  const html = page();
  assert.equal(count(html, /<footer class="made">[\s\S]*?<\/footer>/g), 1);
});

test("shape tokens exist and the chrome uses them", () => {
  const t = tokenCss();
  assert.ok(t.includes("--radius:12px") && t.includes("--pill:999px"));
  const css = viewerAssets().css;
  const radius = (sel: string) => css.match(new RegExp(`(?:^|[},])${sel.replace(/[.\[\]]/g, "\\$&")}\\{[^}]*?border-radius:([^;}]+)`))?.[1] ?? css.match(new RegExp(`(?:^|[},])(?:[^{}]*,)?${sel.replace(/[.\[\]]/g, "\\$&")}(?:,[^{}]*)?\\{[^}]*?border-radius:([^;}]+)`))?.[1];
  for (const s of [".zoom", ".hist", ".sbox", ".fbar", ".crumbmenu", ".dial", ".copy", ".panel"]) assert.equal(radius(s), "var(--radius)", s);
  assert.match(css, /#insp\{[^}]*?border-radius:var\(--radius\)/);
  for (const s of [".sw", ".sbtn kbd", ".crumbs button.more"]) assert.equal(radius(s), "var(--pill)", s);
  assert.ok(css.includes(".mk-l") && css.includes(".mk-d") && /\[data-theme=dark\] \.brand \.mk-l/.test(css));
});

test("the zoom row holds four buttons; Export sits in the top bar's actions", () => {
  const html = page();
  const row = html.match(/<div class="zoom">([\s\S]*?)<\/div>/)![1];
  assert.equal(count(row, /<button /g), 4);
  assert.deepEqual([...row.matchAll(/<button id="(\w+)"/g)].map((m) => m[1]), ["zfs", "zfit", "zin", "zout"]);
  const fs = row.match(/<button id="zfs"[^>]*>/)![0], fit = row.match(/<button id="zfit"[^>]*>/)![0];
  assert.ok(/ hidden[ >]/.test(fs) && fs.includes('aria-label="Full screen"') && fs.includes('aria-pressed="false"'));
  assert.ok(/ hidden[ >]/.test(fit) && fit.includes('aria-label="Reframe"'));
  const bar = html.match(/<div class="actions" id="actions"[^>]*>([\s\S]*?)<\/div>/)![1];
  const exp = bar.match(/<button [^>]*id="zexp"[^>]*>/)![0];
  assert.ok(exp.includes('aria-label="Export this view"') && exp.includes('aria-haspopup="menu"'));
});

test("full screen takes the stage (canvas and tour card), not the page", () => {
  const html = page();
  assert.equal(count(html, /<div class="stage" id="stage">/g), 1);
  const stage = html.match(/<div class="stage" id="stage">([\s\S]*?)<aside>/)![1];
  assert.ok(stage.includes('id="canvas"') && stage.includes('class="zoom"'));
  assert.ok(!stage.includes("<header") && !stage.includes("<aside"));
  const css = viewerAssets().css;
  assert.ok(css.includes(".stage:fullscreen") && css.includes(".stage{display:contents}"));
});

test("the export menu stacks above the detail dial", () => {
  const css = viewerAssets().css;
  const z = (sel: string) => Number(css.match(new RegExp(`(?:^|[},])${sel.replace(/[.\[\]]/g, "\\$&")}\\{[^}]*?z-index:(\\d+)`))?.[1]);
  assert.ok(z(".xmenu") > z(".dial"), `${z(".xmenu")} vs ${z(".dial")}`);
});
