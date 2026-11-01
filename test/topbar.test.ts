// The floating top bar's pure parts (#41): which actions show, the tours menu markup and the key / filter agreement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionsFor, toursHtml } from "../src/viewer/topactions.ts";
import { ICONS } from "../src/viewer/baricons.ts";

test("actionsFor: Export always; Tours and Filters only with something to show and never embedded", () => {
  assert.deepEqual(actionsFor({ tours: 0, toggles: 0, embed: false }), ["export"]);
  assert.deepEqual(actionsFor({ tours: 2, toggles: 0, embed: false }), ["tours", "export"]);
  assert.deepEqual(actionsFor({ tours: 0, toggles: 3, embed: false }), ["filters", "export"]);
  assert.deepEqual(actionsFor({ tours: 1, toggles: 1, embed: false }), ["tours", "filters", "export"]);
  assert.deepEqual(actionsFor({ tours: 4, toggles: 4, embed: true }), ["export"]);
});

test("the tours menu escapes titles and ids and pluralizes steps", () => {
  const html = toursHtml([{ id: `a"<b>`, title: `<i>One</i> & co`, steps: 1 }, { id: "@read", title: "Read", steps: 3 }]);
  assert.ok(!html.includes("<i>One") && html.includes("&lt;i&gt;One&lt;/i&gt;"));
  assert.ok(html.includes('data-tour="a&quot;&lt;b&gt;"'));
  assert.ok(html.includes("1 step<") && html.includes("3 steps<"));
  assert.equal((html.match(/role="menuitem"/g) ?? []).length, 2);
});

test("the four bar icons are inline, decorative, currentColor line drawings", () => {
  assert.deepEqual(Object.keys(ICONS).sort(), ["export", "filter", "search", "tour"]);
  for (const s of Object.values(ICONS)) {
    assert.ok(s.includes('viewBox="0 0 16 16"') && s.includes('aria-hidden="true"') && s.includes('stroke="currentColor"'));
    assert.ok((s.match(/<(?:path|circle)/g) ?? []).length <= 3);
  }
});

test("the legend splits into rows and the panel's key is composed from them", () => {
  const src = readFileSync(new URL("../src/viewer/legend.ts", import.meta.url), "utf8");
  assert.ok(src.includes("export function legendItems") && src.includes("export const toggleRows"));
  assert.ok(/keyCard\(extraRows \+ legendItems\(\)\.map/.test(src), "legend() composes the key from legendItems()");
});

test("the bar collapses to icons at 760px", () => {
  const css = readFileSync(new URL("../src/viewer/topbar.css", import.meta.url), "utf8");
  assert.ok(css.includes(".bmenu") && css.includes("max-width: 760px") && /\.tbact \.lbl/.test(css));
});
