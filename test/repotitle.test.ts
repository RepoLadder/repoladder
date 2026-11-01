import { test } from "node:test";
import assert from "node:assert/strict";
import { titleParts } from "../src/viewer/repotitle.ts";

const names: Record<string, string> = { api: "API", db: "Database" };
const sums: Record<string, string> = { root: "Whole repo.", api: "Handles <requests>." };
const parts = (cur: string, d: number, home = false) => titleParts(cur, d, "acme", (id) => names[id], (id) => sums[id], home);

test("home board: repo name, Overview, the root summary", () => {
  assert.deepEqual(parts("root", 0, true), { level: "Overview", title: "acme", summary: "Whole repo." });
});

test("nested board: its name, rungs down, its own summary; a missing summary is empty", () => {
  assert.deepEqual(parts("api", 2), { level: "2 rungs down", title: "API", summary: "Handles <requests>." });
  assert.equal(parts("db", 1).summary, "");
  assert.equal(parts("db", 1).level, "1 rung down");
});

test("story level takes the root's summary", async () => {
  const { STORY } = await import("../src/viewer/state.ts");
  assert.equal(parts(STORY, 0, true).summary, "Whole repo.");
});

test("renderBoardTitle writes text only (hostile text stays inert) and leaves unchanged nodes alone", async () => {
  const { st } = await import("../src/viewer/state.ts");
  const { renderBoardTitle } = await import("../src/viewer/repotitle.ts");
  const mk = () => { let writes = 0, t = ""; return { get textContent() { return t; }, set textContent(v: string) { t = v; writes++; }, get writes() { return writes; }, hidden: true, scrollHeight: 0, clientHeight: 0 }; };
  const els: Record<string, ReturnType<typeof mk>> = { ".bt-level": mk(), h1: mk(), ".bt-sum": mk(), ".bt-more": mk() };
  const box = { querySelector: (s: string) => els[s] ?? null };
  (globalThis as any).document = { getElementById: () => box, querySelector: (s: string) => els[s] ?? null };
  (globalThis as any).matchMedia = () => ({ matches: false });
  st.data = { repo: "<img src=x onerror=a>", layout: {}, nodes: { root: { name: "r", parent: null, children: [], summary: "s" } } } as any;
  st.cur = "root";
  try {
    renderBoardTitle();
    assert.equal(els.h1!.textContent, "<img src=x onerror=a>");
    const n = els.h1!.writes;
    renderBoardTitle();
    assert.equal(els.h1!.writes, n);
  } finally { delete (globalThis as any).document; delete (globalThis as any).matchMedia; }
});
