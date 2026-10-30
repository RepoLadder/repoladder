import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { FAVICON_HREF, FAVICON_KB, HEADER_MARK, composeMark, headerMark, minifySvg, prefixIds, svgDataUri } from "../src/build/mark.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";

const read = (f: string) => readFileSync(new URL(`../src/build/${f}`, import.meta.url));
const light = read("mark.svg").toString("utf8"), dark = read("mark-dark.svg").toString("utf8");
const page = () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  const g = defaultGrouping(facts);
  return renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
};

test("the page has exactly one svg icon link, a percent-encoded data URI between <title> and <header>", () => {
  const html = page();
  const links = html.match(/<link rel="icon"[^>]*>/g) ?? [];
  assert.equal(links.length, 1);
  assert.match(links[0]!, /type="image\/svg\+xml"/);
  assert.match(links[0]!, /href="data:image\/svg\+xml,/);
  assert.ok(!links[0]!.includes("base64"));
  assert.ok(html.indexOf("</title>") < html.indexOf("<link rel=\"icon\"") && html.indexOf("<link rel=\"icon\"") < html.indexOf("<header>"));
});

test("the committed constants match the committed svg copies", () => {
  assert.equal(FAVICON_HREF, svgDataUri(composeMark(light, dark)));
  assert.equal(HEADER_MARK, headerMark(light, dark));
});

test("the favicon fits its budget and is clean, with both themes", () => {
  assert.ok(Buffer.byteLength(FAVICON_HREF) <= FAVICON_KB * 1024, `${Buffer.byteLength(FAVICON_HREF)} bytes`);
  const svg = decodeURIComponent(FAVICON_HREF.slice("data:image/svg+xml,".length));
  assert.ok(svg.includes("prefers-color-scheme:dark") && svg.includes("class='l'") && svg.includes("class='d'"));
  for (const bad of ['"', "<?xml", "<!--", "<title", "sodipodi:", "inkscape:"]) assert.ok(!svg.includes(bad), bad);
});

test("the svg copies are the site's brand marks, byte for byte", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  assert.equal(sha(read("mark.svg")), "a9547b1b7bf8effd3b450f389d774bf5c0bf78194b4b4d976a03a205a1b085c3");
  assert.equal(sha(read("mark-dark.svg")), "c41e2670545470d6040ab11a41d43cad32bc0df24800427efdf7043a1d46d530");
});

test("two builds are byte-identical and the page is a fragment", () => {
  const a = page();
  assert.equal(a, page());
  assert.ok(!/^\s*<!doctype/i.test(a));
});

test("minifySvg strips the editor cruft and single-quotes", () => {
  const out = minifySvg(`<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns:inkscape="x" data-name="a">\n <title>T</title>\n <inkscape:foo bar="1"/>\n <g inkscape:label="L" fill="red"></g>\n</svg>`);
  assert.equal(out, "<svg><g fill='red'></g></svg>");
});

test("prefixIds rewrites an id with its references", () => {
  assert.equal(prefixIds("<clipPath id='base'/><g clip-path='url(#base)'/><use href='#base'/>", "p-"), "<clipPath id='p-base'/><g clip-path='url(#p-base)'/><use href='#p-base'/>");
});

test("composeMark with dark has one open tag, both groups and the d- prefix", () => {
  const out = composeMark(light, dark);
  assert.equal(out.match(/<svg\b/g)!.length, 1);
  assert.ok(out.includes("<g class='l'>") && out.includes("<g class='d'>") && out.includes("id='d-base'"));
  assert.equal(composeMark(light), minifySvg(light));
});

test("svgDataUri encodes % first", () => {
  assert.equal(svgDataUri("<a b=\"50%\" c='#1'/>"), "data:image/svg+xml,%3Ca b=%2250%25%22 c='%231'/%3E");
});
