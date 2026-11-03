import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function skill(name: string): { fm: Record<string, string>; body: string } {
  const text = readFileSync(fileURLToPath(new URL(`../plugin/skills/${name}/SKILL.md`, import.meta.url)), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${name} has a frontmatter block`);
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    assert.ok(i > 0, `${name} frontmatter line: ${line}`);
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: m[2] };
}

const tools = (s: string) => s.split(",").map((t) => t.trim());

test("map opens locally with Ask and no longer publishes", () => {
  const { fm, body } = skill("map");
  assert.ok(fm.description);
  assert.equal(fm["disable-model-invocation"], "true");
  assert.ok(!tools(fm["allowed-tools"]).includes("Artifact"));
  assert.ok(tools(fm["allowed-tools"]).includes("AskUserQuestion"));
  for (const t of ["serve", "SERVE_OK", "--no-open", "Open it with Ask?"]) assert.ok(body.includes(t), t);
  assert.ok(!body.includes("with the Artifact tool"));
  assert.ok(!body.includes("## 5. Publish"));
});

test("share-map is platform-neutral", () => {
  const { fm, body } = skill("share-map");
  assert.ok(fm.description);
  assert.ok(!("disable-model-invocation" in fm));
  assert.ok(!("allowed-tools" in fm));
  const text = (fm.description + "\n" + body).split("${CLAUDE_PLUGIN_ROOT}").join("");
  for (const w of ["Artifact", "Claude", "claude"]) assert.ok(!text.includes(w), w);
  assert.ok(body.includes("REPO/.repoladder/diagram.html"));
  assert.ok(body.includes("no Ask bar"));
});

test("share-map-claude publishes an Artifact and remembers the link", () => {
  const { fm, body } = skill("share-map-claude");
  assert.ok(fm.description);
  assert.ok(!("disable-model-invocation" in fm));
  const t = tools(fm["allowed-tools"]);
  for (const x of ["Artifact", "Read", "Write"]) assert.ok(t.includes(x), x);
  assert.ok(body.includes("artifact.json"));
  assert.ok(body.includes("no Ask bar"));
});
