import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES } from "@repoladder/brand";
import { MODES, planCompare, renderCompare, renderSheet, renderTours, shotFile, slugs, type Manifest, type TourRow } from "../scripts/shots.ts";

test("board slugs are file-safe and unique", () => {
  assert.deepEqual(slugs(["root", "web/app", "web app", "web:app", "../x", ""]), ["root", "web_app", "web_app-2", "web_app-3", ".._x", "board"]);
  for (const s of slugs(["a/b\\c?d*e"])) assert.match(s, /^[a-z0-9._-]+$/i);
});

const board = (id: string, slug = id) => ({ id, slug, label: id });

test("compare pairs shots by repo, board and mode", () => {
  const before: Manifest = { repoladderSha: "a", repos: [{ name: "r", boards: [board("root"), board("old"), board("x", "x-before")] }, { name: "gone", boards: [board("root")] }] };
  const after: Manifest = { repoladderSha: "b", repos: [{ name: "r", boards: [board("root"), board("new"), board("x", "x-after")] }] };
  const seen: [string, string][] = [];
  const rows = planCompare(before, after, (b, a) => { seen.push([b, a]); return !a.includes("root-desktop-dark"); });
  const pick = (repo: string, id: string) => rows.filter((r) => r.repo === repo && r.board.id === id).map((r) => r.change);
  assert.deepEqual(pick("r", "root"), ["same", "changed", "same"]);
  assert.deepEqual(pick("r", "new"), ["added", "added", "added"]);
  assert.deepEqual(pick("r", "old"), ["removed", "removed", "removed"]);
  assert.deepEqual(pick("gone", "root"), ["removed", "removed", "removed"]);
  // A board whose slug changed is still compared with itself.
  assert.ok(seen.some(([b, a]) => b === shotFile("r", "x-before", MODES[0].id) && a === shotFile("r", "x-after", MODES[0].id)));
  assert.equal(planCompare(before, after, () => true, ["gone"]).every((r) => r.repo === "gone"), true);
});

test("sheets link every shot and escape labels", () => {
  const m: Manifest = { repoladderSha: "abc1234", repos: [{ name: "r", boards: [{ id: "root", slug: "root", label: "<Overview>" }] }] };
  const html = renderSheet(m);
  for (const md of MODES) assert.ok(html.includes(`src="r/root-${md.id}.png"`));
  assert.ok(html.includes("&lt;Overview&gt;") && !html.includes("<Overview>"));
  const rows = planCompare(m, m, (b, a) => a.endsWith("phone-light.png"));
  const cmp = renderCompare(rows, "../before", { before: "aaaaaaa", after: "bbbbbbb" });
  assert.ok(cmp.includes(`src="../before/r/root-desktop-light.png"`) && cmp.includes("compare/r/root-desktop-dark.png"));
  assert.ok(!cmp.includes("root-phone-light.png"));
  assert.match(renderCompare(planCompare(m, m, () => true), "x", { before: "a", after: "b" }), /No board looks different/);
});

test("the tours sheet shows a shot per step, flags covered steps, and pairs before/after by file", () => {
  const rows: TourRow[] = [
    { repo: "r", tour: "first-paint", step: "1", file: "tours/r/first-paint-1.png", covered: [] },
    { repo: "r", tour: "first-paint", step: "2", file: "tours/r/first-paint-2.png", covered: ["n:<a>"] },
    { repo: "r", tour: "first-paint", step: "done", file: "tours/r/first-paint-done.png", covered: [] },
  ];
  const html = renderTours(rows);
  for (const r of rows) assert.ok(html.includes(`src="${r.file}"`));
  assert.ok(!html.includes("Before"));
  assert.match(html, /3 steps · 1 with a lit box under a corner button/);
  assert.equal(html.match(/class="tag removed"/g)?.length, 1, "only the covered step is flagged");
  assert.ok(html.includes("covered: n:&lt;a&gt;"));
  const cmp = renderTours(rows, "../before");
  assert.ok(cmp.includes(`src="../before/tours/r/first-paint-2.png"`) && cmp.includes(`src="tours/r/first-paint-2.png"`) && cmp.includes("After"));
  assert.match(renderTours([]), /No tours/);
});

const OLD = ["#101513", "#F3F5F2", "#62C2A5", "#161D1A", "#2A3430", "#D7DDD8", "#1F6F5C", "#18201D", "#5B6660", "#E3E9E5", "#98A49E"];

test("the shots sheet carries the brand palette, not the old greens", () => {
  const html = renderSheet({ repoladderSha: "abc1234", repos: [{ name: "r", boards: [board("root")] }] });
  for (const k of ["ground", "surface", "ink", "muted", "line", "accent"] as const) for (const t of ["light", "dark"] as const) assert.ok(html.includes(THEMES[t][k]), `${t} ${k}`);
  for (const old of OLD) assert.ok(!html.toLowerCase().includes(old.toLowerCase()), old);
});
