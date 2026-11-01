// Citation checking: exact, case-sensitive, linear, and plain strings only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { candidates, segments, NOT_FOUND, type Segment } from "../src/model/cite.ts";
import type { Facts } from "../src/model/schema.ts";

const facts = analyze(fileURLToPath(new URL("fixtures/basic-app", import.meta.url)));
const refs = (s: Segment[]) => s.filter((x): x is Extract<Segment, { ref: string }> => "ref" in x);
const one = (text: string, f: Facts = facts, boxes?: Record<string, string>) => { const r = refs(segments(text, f, boxes)); assert.equal(r.length, 1, text); return r[0]; };
const synth = (files: [string, number, string[]?][], endpoints: Facts["endpoints"] = []) =>
  ({ ...facts, files: files.map(([path, loc, exports]) => ({ path, pkg: "x", loc, exports })), endpoints }) as Facts;

test("a nonexistent path is flagged, a real one verifies with a target", () => {
  assert.deepEqual(one("see src/nope/ghost.ts for it"), { ref: "src/nope/ghost.ts", kind: "file", verified: false, reason: NOT_FOUND });
  assert.deepEqual(one("see src/lib/cart.ts."), { ref: "src/lib/cart.ts", kind: "file", verified: true, target: { file: "src/lib/cart.ts" } });
  assert.equal(one("(src/lib/cart.ts)").verified, true);
});

test("line citations are checked against the line count", () => {
  assert.deepEqual(one("src/lib/cart.ts:2").target, { file: "src/lib/cart.ts", line: 2 });
  assert.equal(one("src/lib/cart.ts#L1").verified, true);
  assert.equal(one("src/lib/cart.ts:1-2").verified, true);
  assert.equal(one("src/lib/cart.ts:3").reason, "line 3 is past the end (file has 2 lines)");
  assert.equal(one("src/lib/cart.ts:0").verified, false);
  assert.equal(one("src/lib/cart.ts:1-9").reason, "line 9 is past the end (file has 2 lines)");
  assert.equal(one("src/lib/cart.ts:2-1").verified, false);
});

test("./ normalises; absolute and .. paths are unverified", () => {
  assert.equal(one("./src/lib/cart.ts").verified, true);
  assert.equal(one("/src/lib/cart.ts").verified, false);
  assert.equal(one("src/../src/lib/cart.ts").verified, false);
});

test("basenames verify only when unique", () => {
  const f = synth([["a/x.ts", 5], ["b/x.ts", 5], ["c/y.ts", 5]]);
  assert.equal(one("`y.ts`", f).verified, true);
  assert.equal(one("`y.ts`", f).kind, "file");
  assert.deepEqual(one("`x.ts`", f), { ref: "`x.ts`", kind: "file", verified: false, reason: "matches 2 files" });
});

test("URLs are never paths", () => {
  assert.deepEqual(candidates("https://example.com/a/b.ts and http://x.io/y/z.js and www.x.io/a.ts"), []);
});

test("names match exactly: no substrings, no other case", () => {
  assert.equal(one("`Button`").verified, true);
  assert.equal(one("`Butto`").verified, false);
  assert.equal(one("`button`").verified, false);
  assert.deepEqual(refs(segments("The Button is nice", facts)), []);
});

test("export and endpoint names carry their line, when the facts have one", () => {
  assert.deepEqual(one("`fetchUser`").target, { file: "src/lib/index.ts", line: 1 });
  assert.equal(one("`Button`").kind, "export");
  const f = synth([["a.ts", 5, ["go"]]], [{ name: "GET /api/x", file: "api.ts", line: 7, kind: "http" } as Facts["endpoints"][number]]);
  assert.deepEqual(one("`GET /api/x`", f), { ref: "`GET /api/x`", kind: "endpoint", verified: true, target: { file: "api.ts", line: 7 } });
  assert.deepEqual(one("`go`", f).target, { file: "a.ts" });
});

test("box names verify only in bold or a code span; duplicates are ambiguous", () => {
  const boxes = { billing: "Billing", a1: "Same", a2: "Same", cart: "Shopping cart" };
  assert.deepEqual(one("the **Billing** part", facts, boxes), { ref: "**Billing**", kind: "box", verified: true, target: { box: "billing" } });
  assert.equal(one("`Shopping cart`", facts, boxes).verified, true);
  assert.deepEqual(refs(segments("the Billing part", facts, boxes)), []);
  assert.equal(one("**Same**", facts, boxes).verified, false);
  assert.match(one("**Same**", facts, boxes).reason!, /ambiguous/);
  assert.deepEqual(refs(segments("**Billing**", facts)), []);
});

test("markup in a citation is never a ref and never becomes anything but strings", () => {
  const t = "`src/<img onerror=alert(1)>.ts`";
  assert.deepEqual(segments(t, facts), [{ text: t }]);
  const r = one("see src/a<b>/x.ts");
  assert.equal(r.verified, false);
  assert.equal(typeof r.ref, "string");
});

const rnd = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
test("random text: segments rebuild the input and two runs agree", () => {
  const r = rnd(7), alphabet = ["`", "``", "/", ".", "*", "**", "src/lib/cart.ts", ":12", "#L3", " ", "\n", "é", "😀", "Button", "(", ")", "x", "../", "ts"];
  for (let k = 0; k < 300; k++) {
    let t = "";
    for (let i = 0, n = Math.floor(r() * 60); i < n; i++) t += alphabet[Math.floor(r() * alphabet.length)];
    const a = segments(t, facts, { b: "Button" }), b = segments(t, facts, { b: "Button" });
    assert.equal(a.map((s) => ("text" in s ? s.text : s.ref)).join(""), t);
    assert.deepEqual(a, b);
  }
});

test("a 1 MB adversarial string finishes quickly", () => {
  for (const unit of ["/", "./", "`", "``` ``", "**", "a/b.", "`a`/", "/a.ts:", "a`b/c.ts\n"]) {
    const t = unit.repeat(Math.ceil(1_000_000 / unit.length));
    const t0 = performance.now();
    const s = segments(t, facts, { b: "Button" });
    assert.equal(s.map((x) => ("text" in x ? x.text : x.ref)).join(""), t);
    assert.ok(performance.now() - t0 < 1000, `${JSON.stringify(unit)} took ${performance.now() - t0}ms`);
  }
});
