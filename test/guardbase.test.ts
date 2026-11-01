import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compare, refuseUpdate, samePath, type Structure } from "../scripts/guardcompare.ts";

const base = (): Structure => ({
  version: 1, fixture: "t",
  fit: { root: { "1280x800": [0, 0, 100, 50], "390x844": [0, 0, 100, 200] }, web: { "1280x800": [0, 0, 80, 40], "390x844": [0, 0, 80, 160] } },
  wires: { root: { "e:a>b": "M10 10 L20.5 30 C1 2 3 4 5 6" }, web: {} },
  tour: { climb: 380 },
  timing: { in: [{ duration: 400, easing: "ease" }], out: [{ duration: 400, easing: "ease" }], reduced: { in: [{ duration: 220, easing: "ease" }], out: [] } },
});
const edit = (f: (s: Structure) => void) => { const s = structuredClone(base()); f(s); return s; };

test("identical structures compare empty", () => assert.deepEqual(compare(base(), base()), []));

test("a changed fit is reported with its viewport", () => {
  const d = compare(base(), edit((s) => { s.fit.web["390x844"][2] = 90; }));
  assert.equal(d.length, 1);
  assert.match(d[0], /^fit web 390x844/);
});

test("a coordinate shift of 0.3 is ignored, 0.7 is a wire difference", () => {
  assert.deepEqual(compare(base(), edit((s) => { s.wires.root["e:a>b"] = "M10.3 10 L20.5 30 C1 2 3 4 5 6"; })), []);
  const d = compare(base(), edit((s) => { s.wires.root["e:a>b"] = "M10.7 10 L20.5 30 C1 2 3 4 5 6"; }));
  assert.match(d[0], /^wire root e:a>b/);
});

test("a changed path token structure is a wire difference", () => {
  const d = compare(base(), edit((s) => { s.wires.root["e:a>b"] = "M10 10 L20.5 30 L1 2"; }));
  assert.match(d[0], /^wire root/);
});

test("a changed duration or easing is a timing difference", () => {
  assert.match(compare(base(), edit((s) => { s.timing.in[0].duration = 500; }))[0], /^timing - in: 400ms ease became 500ms ease/);
  assert.match(compare(base(), edit((s) => { s.timing.out[0].easing = "linear"; }))[0], /^timing - out/);
  assert.match(compare(base(), edit((s) => { s.tour.climb = 400; }))[0], /^timing - tour\.climb/);
});

test("removed and added boards are reported", () => {
  assert.deepEqual(compare(base(), edit((s) => { delete s.fit.web; })), ["board web removed"]);
  assert.deepEqual(compare(base(), edit((s) => { s.fit.extra = {}; })), ["board extra added"]);
});

test("samePath compares tokens within half a unit", () => {
  assert.equal(samePath("M0 0 L10 10", "M0.4 0 L10 9.6"), true);
  assert.equal(samePath("M0 0 L10 10", "M0.6 0 L10 10"), false);
  assert.equal(samePath("M0 0 L10 10", "M0 0 C10 10"), false);
  assert.equal(samePath("M0 0", "M0 0 L1 1"), false);
});

test("the committed baseline has the tourapp boards, both viewports, wires and drill timing", () => {
  const b: Structure = JSON.parse(readFileSync(new URL("./baselines/viewer-structure.json", import.meta.url), "utf8"));
  assert.equal(b.version, 1);
  assert.ok(Object.keys(b.fit).length >= 2 && b.fit.root);
  for (const v of Object.values(b.fit)) assert.deepEqual(Object.keys(v).sort(), ["1280x800", "390x844"]);
  assert.ok(Object.values(b.wires).some((w) => Object.keys(w).length > 0));
  assert.ok(b.timing.in.length > 0 && b.timing.out.length > 0);
  assert.ok(Object.keys(b.tour).length > 0);
});

test("--update is refused when CI is set", () => {
  assert.match(refuseUpdate({ CI: "true" }) ?? "", /refused/);
  assert.equal(refuseUpdate({}), null);
});
