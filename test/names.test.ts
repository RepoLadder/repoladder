// The rename (#297) is a clean break: the old product name appears only where it is history or an address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const OLD = ["code", "wehb"].join("");
const HISTORY = [/^docs\/detail-dial-v2\.md$/, /^test\/names\.test\.ts$/];
const has = (s: string) => s.toLowerCase().includes(OLD);

function grep(): string[] | null {
  try {
    const out = execFileSync("git", ["grep", "-n", "-i", "-I", OLD, "--", ".", ":(exclude)plugin/dist"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    return (e as { status?: number }).status === 1 ? [] : null;
  }
}

test("the old product name survives only in history, [r3:] answer tags and the dev-tooling address", (t) => {
  const hits = grep();
  if (hits === null) return t.skip("not a git checkout");
  const bad = hits.filter((h) => {
    const m = /^([^:]+):\d+:(.*)$/.exec(h);
    if (!m) return true;
    const [, path, text] = m;
    if (HISTORY.some((r) => r.test(path))) return false;
    let rest = text.replace(/\[r3:[^\]]*\]/g, "");
    return has(rest);
  });
  assert.deepEqual(bad, []);
});
