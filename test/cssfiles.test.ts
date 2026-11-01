import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../src/viewer/", import.meta.url);
const lines = (f: string) => readFileSync(new URL(f, dir), "utf8").split("\n").length - 1;

// board.css is the diagram's own styling, already past 200 lines when the rest was split: it may not grow.
const LIMIT: Record<string, number> = { "board.css": 300 };

test("every viewer stylesheet stays within its line budget", () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".css"))) {
    assert.ok(lines(f) <= (LIMIT[f] ?? 200), `${f}: ${lines(f)} lines`);
  }
});

test("styles.css is only the entry: its comment and the ordered imports", () => {
  assert.ok(lines("styles.css") < 40);
  const body = readFileSync(new URL("styles.css", dir), "utf8").split("\n").filter((l) => l && !l.startsWith("/*"));
  assert.ok(body.every((l) => /^@import "\.\/[\w-]+\.css";$/.test(l)));
});
