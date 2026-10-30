import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pngSize } from "../scripts/pngsize.ts";
import { DEVICES, PREFIX, exportPath, READY_SCRIPT, VIEWPORT, findDevice, parseArgs, runtimeAvailable, shotPath, wrapHtml } from "../scripts/phoneshots.ts";

const count = (s: string, sub: string) => s.split(sub).length - 1;

test("wrapHtml adds one viewport meta and the ready beacon, keeping the page intact", () => {
  const plain = "<html><body><p>hi</p></body></html>";
  const a = wrapHtml(plain);
  assert.equal(count(a, 'name="viewport"'), 1);
  assert.ok(a.startsWith(VIEWPORT));
  assert.ok(a.includes(plain));
  const withMeta = '<html><head><meta name="viewport" content="width=500"></head></html>';
  const b = wrapHtml(withMeta);
  assert.equal(count(b, 'name="viewport"'), 1);
  assert.ok(b.includes(withMeta));
  assert.ok(b.endsWith(READY_SCRIPT));
  assert.match(READY_SCRIPT, /\/__ready/);
  assert.match(READY_SCRIPT, /__repoladder/);
});

test("parseArgs defaults and flags", () => {
  const d = parseArgs([]);
  assert.deepEqual(d.schemes, ["light", "dark"]);
  assert.equal(d.devices.length, 2);
  assert.equal(d.settleMs, 2000);
  assert.equal(d.shutdown, false);
  assert.equal(d.only, undefined);
  const a = parseArgs(["--only", "a,b", "--scheme", "dark", "--device", "iphone-se", "--hash", "story=1", "--shutdown", "--settle", "0"]);
  assert.deepEqual(a.only, ["a", "b"]);
  assert.deepEqual(a.schemes, ["dark"]);
  assert.deepEqual(a.devices.map((x) => x.id), ["iphone-se"]);
  assert.equal(a.hash, "story=1");
  assert.equal(a.shutdown, true);
  assert.equal(a.settleMs, 0);
  assert.equal(parseArgs(["--hash", "#x"]).hash, "x");
  assert.equal(parseArgs(["--device", "all"]).devices.length, 2);
});

test("parseArgs rejects bad input", () => {
  for (const bad of [["--scheme", "blue"], ["--device", "pixel"], ["--settle", "-1"], ["--settle", "abc"], ["--bogus"], ["--only"]]) {
    assert.throws(() => parseArgs(bad), Error, bad.join(" "));
  }
});

const RT = "com.apple.CoreSimulator.SimRuntime.iOS-17-5";
const list = {
  devices: {
    [RT]: [
      { name: "repoladder Phone iPhone 15", udid: "U1", state: "Booted", isAvailable: true },
      { name: "iPhone 15", udid: "U2", state: "Shutdown", isAvailable: true },
      { name: "repoladder Phone iPhone SE", udid: "U3", state: "Shutdown", isAvailable: false },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [{ name: "repoladder Phone iPhone SE", udid: "U4", state: "Shutdown", isAvailable: true }],
  },
};

test("findDevice matches the exact name on the pinned runtime only", () => {
  assert.deepEqual(findDevice(list, "repoladder Phone iPhone 15"), { udid: "U1", state: "Booted" });
  assert.equal(findDevice(list, "iPhone 15", "com.apple.CoreSimulator.SimRuntime.iOS-26-2"), undefined);
  assert.equal(findDevice(list, "repoladder Phone iPhone SE"), undefined); // unavailable, and the iOS 26 one is another runtime
  assert.equal(findDevice({}, "x"), undefined);
});

test("runtimeAvailable", () => {
  assert.equal(runtimeAvailable({ runtimes: [{ identifier: RT, isAvailable: true }] }), true);
  assert.equal(runtimeAvailable({ runtimes: [{ identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", isAvailable: true }] }), false);
  assert.equal(runtimeAvailable({ runtimes: [{ identifier: RT, isAvailable: false }] }), false);
  assert.equal(runtimeAvailable({}), false);
});

test("device names carry the prefix and shot paths are per device", () => {
  for (const d of DEVICES) assert.ok(d.name.startsWith(PREFIX));
  assert.equal(shotPath("/o", "iphone-15", "excalidraw", "dark"), "/o/iphone-15/excalidraw-dark.png");
});


test("--export asks the page for its viewer PNG and names the file beside the shot", () => {
  assert.equal(parseArgs([]).export, false);
  assert.equal(parseArgs(["--export"]).export, true);
  assert.match(READY_SCRIPT, /export=1/);
  assert.match(READY_SCRIPT, /exportView\("png"\)/);
  assert.match(READY_SCRIPT, /\/__export/);
  assert.equal(exportPath("/o", "iphone-se", "d", "dark"), "/o/iphone-se/d-dark-export.png");
});

test("pngSize reads the IHDR chunk and rejects anything else", () => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(780, 16);
  b.writeUInt32BE(1688, 20);
  assert.deepEqual(pngSize(b), { w: 780, h: 1688 });
  assert.equal(pngSize(Buffer.from("not a png at all, just text.....")), null);
  assert.equal(pngSize(new Uint8Array(3)), null);
});
