import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundlePlugin } from "../scripts/bundle.ts";
import { bundleStamp, firstDiff, sourceMoved, verify } from "../scripts/verifydist.ts";

const withMarker = (s: string, body = "x") => `#!/usr/bin/env node\n// repoladder-build: ${s}\n${body}\n`;

test("bundleStamp reads the marker from the head only", () => {
  assert.equal(bundleStamp(withMarker("abc1234")), "abc1234");
  assert.equal(bundleStamp("#!/usr/bin/env node\nconsole.log(1)\n"), null);
  assert.equal(bundleStamp("x".repeat(400) + "\n// repoladder-build: abc1234\n"), null);
});

test("firstDiff", () => {
  assert.equal(firstDiff("a\nb", "a\nb"), null);
  assert.deepEqual(firstDiff("a\nbc", "a\nbd"), { offset: 3, line: 2 });
});

const git = (out: string) => () => out;
const boom = () => { throw new Error("bad object"); };

test("sourceMoved", () => {
  assert.deepEqual(sourceMoved("abc", git("src/a.ts\nscripts/bundle.ts\n")), ["src/a.ts", "scripts/bundle.ts"]);
  assert.deepEqual(sourceMoved("abc", git("")), []);
  assert.equal(sourceMoved("abc", boom), null);
});

test("verify covers each outcome", () => {
  const a = withMarker("abc1234", "one");
  const b = withMarker("abc1234", "two");
  assert.deepEqual(verify({ committed: a, rebuilt: a, git: boom }), { ok: true });
  const bare = verify({ committed: "no marker", rebuilt: a, git: boom });
  assert.ok(!bare.ok && bare.kind === "nostamp");
  const unk = verify({ committed: a, rebuilt: b, git: boom });
  assert.ok(!unk.ok && unk.kind === "unknown-stamp");
  const stale = verify({ committed: a, rebuilt: b, git: git("src/x.ts\n") });
  assert.ok(!stale.ok && stale.kind === "stale" && stale.detail.includes("src/x.ts"));
  const mis = verify({ committed: a, rebuilt: b, git: git("") });
  assert.ok(!mis.ok && mis.kind === "mismatch" && /offset \d+/.test(mis.detail) && mis.detail.includes(process.version));
});

test("bundlePlugin is reproducible and the stamp is the only varying input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verifydist-test-"));
  try {
    const f = (n: string) => join(dir, n);
    await bundlePlugin({ outfile: f("1.mjs"), version: "abc1234" });
    await bundlePlugin({ outfile: f("2.mjs"), version: "abc1234" });
    await bundlePlugin({ outfile: f("3.mjs"), version: "def5678" });
    const [one, two, three] = ["1", "2", "3"].map((n) => readFileSync(f(`${n}.mjs`), "utf8"));
    assert.equal(one, two);
    assert.ok(one.startsWith("#!/usr/bin/env node\n// repoladder-build: abc1234\n"));
    assert.equal(three.replaceAll("def5678", "abc1234"), one);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
