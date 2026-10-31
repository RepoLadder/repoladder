import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../.github/workflows/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".yml")).sort();
const raw = (f: string) => readFileSync(new URL(f, dir), "utf8");
// Comments never count: drop whole-line comments and trailing `# ...`.
const strip = (t: string) =>
  t.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, "")).join("\n");
const text = (f: string) => strip(raw(f));


const WRITE_ALLOWED: Record<string, string[]> = {
  "rebuild-dist.yml": ["contents"],
  "publish.yml": ["id-token", "contents"],
  "release.yml": ["contents", "pull-requests", "actions"],
};

test("there are workflows to check", () => {
  assert.ok(files.length >= 4);
});

test("no workflow uses pull_request_target", () => {
  for (const f of files) assert.ok(!/pull_request_target/.test(text(f)), `${f} uses pull_request_target`);
});

test("every uses: is pinned to a 40-hex commit SHA", () => {
  for (const f of files) {
    for (const m of text(f).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      const ref = m[1].replace(/^["']|["']$/g, "");
      if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${f}: ${ref} is not SHA-pinned`);
    }
  }
});

test("every workflow declares top-level permissions, with only the allowed write grants", () => {
  for (const f of files) {
    const t = text(f);
    assert.match(t, /^permissions:/m, `${f} has no top-level permissions block`);
    const allowed = WRITE_ALLOWED[f] ?? [];
    for (const m of t.matchAll(/^\s+([a-z-]+):\s*write\s*$/gm)) {
      assert.ok(allowed.includes(m[1]), `${f}: unexpected ${m[1]}: write`);
    }
  }
  for (const [f, scopes] of Object.entries(WRITE_ALLOWED)) {
    for (const s of scopes) assert.match(text(f), new RegExp(`${s}: write`), `${f} should grant ${s}: write`);
  }
});

test("every actions/checkout sets persist-credentials: false (rebuild-dist is the documented exception)", () => {
  for (const f of files) {
    const lines = text(f).split("\n");
    lines.forEach((l, i) => {
      if (!/uses:\s*actions\/checkout@/.test(l)) return;
      const indent = l.match(/^\s*/)![0].length;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === "") continue;
        if (/^\s*-\s/.test(next) && next.match(/^\s*/)![0].length <= indent) break;
        if (next.match(/^\s*/)![0].length < indent) break;
        body.push(next);
      }
      const want = f === "rebuild-dist.yml" ? "true" : "false";
      assert.match(body.join("\n"), new RegExp(`persist-credentials:\\s*${want}\\b`), `${f}: checkout needs persist-credentials: ${want}`);
    });
  }
  assert.match(raw("rebuild-dist.yml"), /documented exception/);
});

test("PR-triggered workflows reference no secrets; ci.yml uses no github.token", () => {
  for (const f of files) {
    const t = text(f);
    if (/^\s+pull_request:/m.test(t)) assert.ok(!/secrets\./.test(t), `${f} is PR-triggered and references secrets`);
  }
  const ci = text("ci.yml");
  const uses = ci.split("\n").filter((l) => /github\.token/.test(l));
  assert.equal(uses.length, 0, "github.token does not appear in ci.yml");
});

test("ci.yml triggers: pull_request on main and develop, push on main only", () => {
  const ci = text("ci.yml");
  assert.match(ci, /pull_request:\n\s+branches: \[main, develop\]/);
  assert.match(ci, /push:\n\s+branches: \[main\]\n/);
});

test("publish.yml and rebuild-dist.yml have no pull_request trigger", () => {
  for (const f of ["publish.yml", "rebuild-dist.yml"]) assert.ok(!/^\s+pull_request:/m.test(text(f)), `${f} has a pull_request trigger`);
});
