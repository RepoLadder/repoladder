import { test } from "node:test";
import assert from "node:assert/strict";
import { PROPS, mismatches, parseArgs, pngSize, type Row } from "../scripts/exportcheck.ts";

test("parseArgs reads --only and --work and rejects the rest", () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(["--only", "a,b", "--work", "/w"]), { only: ["a", "b"], work: "/w" });
  assert.throws(() => parseArgs(["--only"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope"]), /unknown flag/);
});

test("mismatches names each differing property and flags a changed element sequence", () => {
  const row = (n: string, v = "x"): Row => [n, ...PROPS.map(() => v)];
  assert.deepEqual(mismatches([row("g.a"), row("rect.")], [row("g.a"), row("rect.")]), []);
  const exp = row("rect."); exp[2] = "y";
  assert.deepEqual(mismatches([row("g.a"), row("rect.")], [row("g.a"), exp]), ["rect. stroke x y"]);
  assert.match(mismatches([row("g.a")], [row("path.")])[0], /element/);
  assert.match(mismatches([row("g.a")], [])[0], /count/);
});

test("pngSize is exported for the page checks", () => {
  assert.equal(pngSize(new Uint8Array(2)), null);
});
