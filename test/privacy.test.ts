import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const privacy = read("PRIVACY.md");
const lines = privacy.split("\n");

function section(): string {
  const start = lines.indexOf("## Where things run");
  assert.ok(start >= 0, "missing heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return rest.slice(0, end < 0 ? undefined : end).join("\n");
}

test("Where things run comes before Usage stats", () => {
  const a = lines.indexOf("## Where things run");
  const b = lines.findIndex((l) => l.startsWith("## Usage stats"));
  assert.ok(a >= 0 && b >= 0 && a < b);
});

test("section has exactly three bullets with the key claims", () => {
  const text = section();
  const bullets = text.split("\n").filter((l) => /^- \*\*/.test(l));
  assert.equal(bullets.length, 3);
  assert.ok(bullets[0].includes("run on your machine"));
  assert.ok(bullets[1].includes("only ever reads public repos"));
  assert.ok(bullets[2].includes("explicit and opt-in"));
});

test("relative links in PRIVACY.md resolve", () => {
  for (const m of privacy.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    const target = m[1];
    if (target.startsWith("http")) continue;
    assert.ok(existsSync(new URL(`../${target}`, import.meta.url)), `dangling link: ${target}`);
  }
});

test("README points at the section", () => {
  assert.ok(read("README.md").includes("](PRIVACY.md#where-things-run)"));
});
