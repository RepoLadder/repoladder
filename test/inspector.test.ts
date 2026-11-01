import assert from "node:assert/strict";
import { test } from "node:test";
import { readPref, setPref, shown, wants } from "../src/viewer/inspector.ts";

test("shown: an explicit choice wins, otherwise the selection or the story decides", () => {
  for (const sel of [false, true]) for (const story of [false, true]) {
    assert.equal(shown("closed", sel, story), false);
    assert.equal(shown("open", sel, story), true);
    assert.equal(shown(null, sel, story), sel || story);
  }
});

test("the preference falls back to a variable when localStorage throws, and reads a stored one", () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  setPref("closed");
  assert.equal(readPref(), "closed");
  setPref("open");
  assert.equal(readPref(), "open");
  const store: Record<string, string> = {};
  g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) };
  setPref("closed");
  assert.equal(store["repoladder.inspector"], "closed");
  delete g.localStorage;
});

test("the I key is ignored with modifiers, in fields, in full screen and when handled", () => {
  const ev = { key: "i", defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false };
  assert.equal(wants(ev, false, false), true);
  assert.equal(wants({ ...ev, key: "I" }, false, false), true);
  assert.equal(wants({ ...ev, key: "j" }, false, false), false);
  assert.equal(wants({ ...ev, ctrlKey: true }, false, false), false);
  assert.equal(wants({ ...ev, metaKey: true }, false, false), false);
  assert.equal(wants({ ...ev, altKey: true }, false, false), false);
  assert.equal(wants({ ...ev, defaultPrevented: true }, false, false), false);
  assert.equal(wants(ev, true, false), false);
  assert.equal(wants(ev, false, true), false);
});
