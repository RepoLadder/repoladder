import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { buildViewer } from "../src/build/viewer.ts";
import { inflateRaw } from "../src/viewer/rawinflate.ts";

test("the boot script's inflater reads what zlib writes: stored, fixed and dynamic blocks", () => {
  const { js, css } = buildViewer();
  const inputs: Buffer[] = [
    Buffer.alloc(0), Buffer.from("a"), Buffer.from("hello hello hello hello"),
    Buffer.from(randomBytes(70_000)), Buffer.alloc(100_000, 7), Buffer.from(`${css}\0${js}`),
    Buffer.from(Array.from({ length: 3000 }, (_, i) => `line ${i % 97}: ${"x".repeat(i % 300)}\n`).join("")),
  ];
  for (const input of inputs) for (const level of [0, 1, 6, 9]) {
    const out = inflateRaw(new Uint8Array(deflateRawSync(input, { level })));
    assert.ok(Buffer.from(out).equals(input), `${input.length} bytes at level ${level}`);
  }
  for (const strategy of [1, 2, 3, 4]) {
    const input = inputs[5];
    assert.ok(Buffer.from(inflateRaw(new Uint8Array(deflateRawSync(input, { strategy })))).equals(input), `strategy ${strategy}`);
  }
  assert.throws(() => inflateRaw(new Uint8Array(deflateRawSync(inputs[6])).subarray(0, 100)));
});
