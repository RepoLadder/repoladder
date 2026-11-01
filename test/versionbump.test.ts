// The classifier behind publish.yml's environment choice: only a major waits for approval.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpKind } from "../scripts/versionbump.ts";

test("bumpKind: classifies each release", () => {
  assert.equal(bumpKind("", "0.3.0"), "first");
  assert.equal(bumpKind("0.3.0", "0.4.0"), "minor");
  assert.equal(bumpKind("0.3.0", "0.3.1"), "patch");
  assert.equal(bumpKind("0.3.0", "1.0.0"), "major");
  assert.equal(bumpKind("0.3.0", "1.0.0-rc.1"), "prerelease");
  assert.equal(bumpKind("1.2.3", "1.2.3"), "none");
  assert.equal(bumpKind("1.2.3", "1.0.0"), "none");
  assert.equal(bumpKind("2.0.0", "1.9.9"), "none");
});

test("bumpKind: 0.x minors are minor, not major", () => {
  assert.equal(bumpKind("0.8.0", "0.9.0"), "minor");
});

test("bumpKind: rejects non-semver input", () => {
  assert.throws(() => bumpKind("0.3.0", "latest"));
  assert.throws(() => bumpKind("0.3.0", "1.0"));
  assert.throws(() => bumpKind("latest", "1.0.0"));
  assert.throws(() => bumpKind("", "1.0"));
});
