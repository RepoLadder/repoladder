// The Ask UI and endpoint name no specific agent: the engines own everything agent-specific.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("no Ask UI file names claude or codex", () => {
  const dir = join(root, "src/viewer/ask");
  const files = [...readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f)), join(root, "src/viewer/ask.css")];
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /claude|codex/i, f);
});

test("ask.ts holds no Claude-specific argv, env, parsing or text", () => {
  const src = readFileSync(join(root, "src/serve/ask.ts"), "utf8");
  for (const bad of ['"--output-format"', '"claude"', "Claude", "REPOLADDER_CLAUDE_BIN"]) assert.ok(!src.includes(bad), bad);
});
