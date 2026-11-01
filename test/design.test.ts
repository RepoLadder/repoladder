import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DESIGN_MODES, FIXTURES, SEL, STATES, compareDesign, modesOf, pixelsDiffer, renderDesignSheet, type DesignBoard, type Reference } from "../scripts/design.ts";
import type { Manifest } from "../scripts/shots.ts";

const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\s*\(/;
const ref: Reference = { radius: "12px", pill: "999px", textScale: null, controls: [{ id: "zoom", label: "Zoom", file: "controls/zoom.png" }] };
const board = (id: string, label: string, modes = modesOf("all")): DesignBoard => ({ id, label, slug: id, modes });
const manifest = (...boards: DesignBoard[]): Manifest => ({ repoladderSha: "abcdef1234", repos: [{ name: "tourapp", boards }] });

test("states: unique kebab-case ids, a valid mode and a known fixture", () => {
  const ids = STATES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of STATES) {
    assert.match(s.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok((DESIGN_MODES as readonly string[]).includes(s.mode), s.id);
    assert.ok(FIXTURES.some((f) => f.id === s.fixture), s.id);
  }
});

test("SEL: every selector is a non-empty string", () => {
  for (const k of ["board", "hit", "searchOpen", "search", "searchInput", "sheet", "grip", "walkCard", "zoom", "topbar", "actions", "tourMenu", "tbtours", "tbfilters", "dial", "copyRow", "filterBar"]) {
    const v = (SEL as Record<string, unknown>)[k];
    assert.ok(typeof v === "string" && v.length > 0, k);
  }
});

test("renderDesignSheet escapes labels, has a section per state and only relative image paths", () => {
  const html = renderDesignSheet(manifest(board("a-b", "<script>alert(1)</script>"), board("sheet-half", "Half", modesOf("phone"))), ref);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal((html.match(/<section class="state"/g) ?? []).length, 2);
  assert.ok(html.includes("sheet-half-phone-light.png") && !html.includes("sheet-half-desktop"));
  for (const m of html.matchAll(/src="([^"]*)"/g)) assert.ok(!m[1].startsWith("/") && !/^[a-z]+:/i.test(m[1]) && !m[1].includes("/Users/"), m[1]);
  assert.ok(!html.includes("/Users/"));
  assert.ok(html.includes("approximation, not the site"));
  assert.ok(html.includes("Not shown"), "no type scale: a note says why");
  assert.ok(html.includes("Floating surfaces") && html.includes("--space-6") && html.includes("var(--shadow-3)"));
  assert.ok(!/\/Users\/|\/home\//.test(html));
});

test("renderDesignSheet shows the type scale when the viewer has one", () => {
  const html = renderDesignSheet(manifest(board("x", "X")), { ...ref, textScale: [{ name: "--text-body", value: "14px" }] });
  assert.ok(html.includes("--text-body") && !html.includes("Not shown"));
});

test("compareDesign: same, changed, added and removed states", () => {
  const png = (s: string) => Buffer.from(s);
  const before = manifest(board("same", "S"), board("diff", "D"), board("gone", "G"));
  const after = manifest(board("same", "S"), board("diff", "D"), board("new", "N"));
  const files: Record<string, Buffer> = {};
  for (const m of modesOf("all")) {
    files[`before:tourapp/same-${m}.png`] = png("1"); files[`after:tourapp/same-${m}.png`] = png("1");
    files[`before:tourapp/diff-${m}.png`] = png("1"); files[`after:tourapp/diff-${m}.png`] = png("2");
    files[`before:tourapp/gone-${m}.png`] = png("1");
    files[`after:tourapp/new-${m}.png`] = png("1");
  }
  const rows = compareDesign(before, after, (side, f) => files[`${side}:${f}`] ?? null);
  const of = (id: string) => new Set(rows.filter((r) => r.board.id === id).map((r) => r.change));
  assert.deepEqual([...of("same")], ["same"]);
  assert.deepEqual([...of("diff")], ["changed"]);
  assert.deepEqual([...of("gone")], ["removed"]);
  assert.deepEqual([...of("new")], ["added"]);
});

test("compareDesign: a mode a state was never shot in is not a change", () => {
  const m = manifest(board("only-phone", "P", modesOf("phone")));
  const file = "tourapp/only-phone-phone-light.png";
  const rows = compareDesign(m, m, (_s, f) => (f === file ? Buffer.from("x") : null));
  assert.ok(rows.every((r) => r.change === "same"));
});

test("scripts/design.ts has no color literals", () => {
  assert.ok(!COLOR.test(readFileSync(new URL("../scripts/design.ts", import.meta.url), "utf8")));
});

test("compareDesign: bytes that differ count as the same when the pixels are alike", () => {
  const m = manifest(board("x", "X", modesOf("phone")));
  const file = (side: string) => (f: string) => (f === "tourapp/x-phone-light.png" ? Buffer.from(side) : null);
  const rows = compareDesign(m, m, (side, f) => file(side)(f), () => true);
  assert.ok(rows.every((r) => r.change === "same"));
  const rows2 = compareDesign(m, m, (side, f) => file(side)(f), () => false);
  assert.ok(rows2.some((r) => r.change === "changed"));
});

test("pixelsDiffer: a few faint pixels are noise, a real change is not", () => {
  const n = 100 * 100, a = new Uint8Array(n * 4).fill(255), b = a.slice();
  b[0] = 250; // one faint pixel
  assert.equal(pixelsDiffer(a, b), false);
  for (let i = 0; i < 40 * 4; i += 4) b[i] = 0; // 40 pixels (0.4%) very different
  assert.equal(pixelsDiffer(a, b), true);
  assert.equal(pixelsDiffer(a, new Uint8Array(8)), true);
});
