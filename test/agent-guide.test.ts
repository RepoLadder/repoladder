import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUDGET } from "../src/build/budget.ts";
import { MAX_FILE_BOXES } from "../src/model/fileboards.ts";
import { Grouping } from "../src/model/schema.ts";
import { SPLIT_OVER } from "../src/model/splits.ts";
import { LARGE_REPO_MARKER, MAX_PART_DIGESTS, PART_OVER, STORY_OFF_MARKER } from "../src/model/summary.ts";
import { envOptOut } from "../src/usage.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(root + f, "utf8");
const PRODUCTS = /\b(codex|cursor|copilot|opencode|gemini|windsurf|aider|cline)\b/i;
const DEFAULT_CMD = "npx repoladder build . --default";
const strip = (s: string) => s.replace(/[*`]/g, "");

/** Numbers the guide quotes, built from the code's own constants. */
function codeNumbers() {
  return [
    `${BUDGET.boxes} boxes`,
    `${BUDGET.edges} arrows`,
    `${BUDGET.namePx}px`,
    `at most ${MAX_PART_DIGESTS}`,
    `over ${PART_OVER} files`,
    `over ${MAX_FILE_BOXES} files`,
    `over ${SPLIT_OVER} files`,
  ];
}

/** One message per problem in the guide: structure, neutrality, numbers, commands. */
export function agentGuideProblems(guide: string, skill: string, install: string, usage: string): string[] {
  const problems: string[] = [];
  const prose = guide.replace(/```[\s\S]*?```/g, "");
  const h1 = guide.replace(/```[\s\S]*?```/g, "").split("\n").filter((l) => /^# /.test(l));
  if (h1.length !== 1) problems.push(`expected one H1, found ${h1.length}`);
  for (const c of guide.match(/<!--[\s\S]*?-->/g) ?? []) if (/#\d+/.test(c)) problems.push("ticket ref in an HTML comment");
  const product = PRODUCTS.exec(guide);
  if (product) problems.push(`names an agent product: ${product[0]}`);

  const block = /```json\n([\s\S]*?)```/.exec(guide)?.[1];
  if (!block) problems.push("no json example");
  else {
    try {
      const r = Grouping.safeParse(JSON.parse(block));
      if (!r.success) problems.push(`json example fails the Grouping schema: ${r.error.issues[0]?.message}`);
    } catch {
      problems.push("json example does not parse");
    }
  }

  // phrases checked against the code and against the skill
  const g = strip(guide).toLowerCase();
  const s = strip(skill).toLowerCase();
  for (const n of [...codeNumbers(), "up to 3 rebuilds"]) if (!g.includes(n.toLowerCase())) problems.push(`guide lacks "${n}"`);
  for (const n of ["12 boxes", "20 arrows", "up to 3 rebuilds", `at most ${MAX_PART_DIGESTS}`, `over ${PART_OVER} files`, `over ${SPLIT_OVER} files`]) {
    if (!s.includes(n)) problems.push(`skill lacks "${n}"`);
    if (!g.includes(n)) problems.push(`guide lacks "${n}" (skill has it)`);
  }
  for (const m of [STORY_OFF_MARKER, LARGE_REPO_MARKER]) if (!guide.includes(m)) problems.push(`guide lacks marker "${m}"`);

  for (const flag of ["--fresh", "--part", "--default", "--no-open"]) {
    if (!prose.includes(flag) && !guide.includes(flag)) problems.push(`guide lacks ${flag}`);
    if (!usage.includes(flag)) problems.push(`${flag} is not in the CLI usage`);
  }
  for (const cmd of guide.match(/npx repoladder (\w+)/g) ?? []) {
    const name = cmd.split(" ")[2];
    if (!new RegExp(`[<|]${name}[|>]`).test(usage)) problems.push(`unknown command ${name}`);
  }
  if (!guide.includes(DEFAULT_CMD) || !install.includes(DEFAULT_CMD)) problems.push("the --default command differs from docs/install.md");
  for (const name of ["REPOLADDER_NO_USAGE", "DO_NOT_TRACK"]) if (!guide.includes(name)) problems.push(`guide lacks ${name}`);
  return problems;
}

const cliUsage = () => /const USAGE = `([^`]*)`/.exec(read("src/cli.ts"))?.[1] ?? "";
const run = (guide = read("docs/agent-guide.md")) =>
  agentGuideProblems(guide, read("plugin/skills/map/SKILL.md"), read("docs/install.md"), cliUsage());

test("the agent guide has no problems", () => {
  assert.deepEqual(run(), []);
});

test("the env names the guide recommends really opt out", () => {
  assert.equal(envOptOut({ REPOLADDER_NO_USAGE: "1" }), true);
  assert.equal(envOptOut({ DO_NOT_TRACK: "1" }), true);
});

test("the agent guide check catches drift", () => {
  const guide = read("docs/agent-guide.md");
  assert.ok(run(guide.replaceAll("12 boxes", "13 boxes")).some((p) => p.includes("12 boxes")));
  assert.ok(run(guide + "\nWorks well with Codex.\n").some((p) => p.includes("agent product")));
  assert.ok(run(guide.replace('"version": 1,', '"version": 1,,')).some((p) => p.includes("json example")));
  assert.ok(run(guide.replaceAll("--part", "--prt")).some((p) => p.includes("--part")));
});
