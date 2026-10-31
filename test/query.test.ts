// `repoladder query`: per-kind rows, the every-row-has-file:line property over the fixtures, limits, errors,
// and that the new `exportLines` field changes nothing else the facts feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { analyze } from "../src/analyze/index.ts";
import { Facts } from "../src/model/schema.ts";
import { defaultGrouping } from "../src/model/grouping.ts";
import { summarize } from "../src/model/summary.ts";
import { QueryError, QUERY_KINDS, runQuery } from "../src/model/query.ts";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const facts = (name: string) => Facts.parse(analyze(join(fixtures, name)));
const q = (f: Facts, kind: string, arg: string, opts = {}) => JSON.parse(runQuery(f, kind, arg, opts));
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof QueryError ? e.code : "OTHER"; } return "NONE"; };

test("definitions: files exporting a name, with the line of the export", () => {
  const r = q(facts("basic-app"), "definitions", "fetchUser");
  assert.deepEqual(r.results.map((x: any) => [x.file, x.line, x.kind]), [["src/lib/index.ts", 1, "export"], ["src/lib/user.ts", 2, "export"]]);
  assert.equal(r.total, 2);
  assert.equal(r.truncated, false);
  assert.deepEqual(q(facts("basic-app"), "definitions", "noSuchName").results, []);
});

test("definitions: endpoints named the same come back too", () => {
  const r = q(facts("checkin"), "definitions", "checkIn");
  assert.ok(r.results.some((x: any) => x.kind === "endpoint" && x.endpoint === "callable" && x.file === "functions/src/checkin/checkin.ts" && x.line === 5));
});

test("importers: every import of a file, with its line", () => {
  const f = facts("basic-app");
  const r = q(f, "importers", "src/lib/user.ts");
  assert.ok(r.results.length > 0);
  for (const row of r.results) assert.ok(f.imports.some((i) => i.from === row.file && i.line === row.line && i.to === "src/lib/user.ts"));
});

test("callers: client call sites of an endpoint, with where it is defined", () => {
  const r = q(facts("checkin"), "callers", "checkIn");
  assert.deepEqual(r.results, [{ file: "web/src/utils/kioskHttp.ts", line: 4, endpoint: "checkIn", kind: "callable", defined: "functions/src/checkin/checkin.ts:5" }]);
});

test("touches database: store uses plus database-category services", () => {
  const f = facts("stores");
  const r = q(f, "touches", "database");
  const dbServices = new Set(f.services.filter((s) => s.category === "database").map((s) => s.id));
  assert.equal(r.total, f.storeUses.length + f.serviceUses.filter((u) => dbServices.has(u.service)).length);
  assert.ok(r.results.some((x: any) => x.via === "store" && x.collection && x.op));
  assert.ok(r.results.some((x: any) => x.via === "service" && x.spec));
  assert.ok(q(f, "touches", "FIRESTORE").results.every((x: any) => x.target.toLowerCase() === "firestore"));
});

test("files: a group's files, for the default grouping and for an inner node", () => {
  const f = facts("checkin");
  const g = defaultGrouping(f);
  const top = g.children[0];
  const r = q(f, "files", top.id, { grouping: g, groupingSource: "default" });
  assert.equal(r.grouping, "default");
  assert.ok(r.total > 0);
  for (const row of r.results) assert.equal(row.line, 1);
});

test("limit: first rows, the true total, truncated", () => {
  const r = q(facts("stores"), "touches", "database", { limit: 2 });
  assert.equal(r.results.length, 2);
  assert.ok(r.total > 2);
  assert.equal(r.truncated, true);
  for (const bad of [0, 501, "x", 1.5, NaN]) assert.equal(code(() => runQuery(facts("stores"), "touches", "database", { limit: bad })), "INVALID_OPTIONS", String(bad));
});

test("errors carry stable codes", () => {
  const f = facts("checkin");
  assert.equal(code(() => runQuery(f, "nope", "x")), "UNKNOWN_QUERY");
  assert.equal(code(() => runQuery(f, undefined, undefined)), "UNKNOWN_QUERY");
  assert.equal(code(() => runQuery(f, "importers", "no/such.ts")), "UNKNOWN_TARGET");
  assert.equal(code(() => runQuery(f, "callers", "noSuch")), "UNKNOWN_TARGET");
  assert.equal(code(() => runQuery(f, "touches", "noSuch")), "UNKNOWN_TARGET");
  assert.equal(code(() => runQuery(f, "files", "noSuch")), "UNKNOWN_TARGET");
  const old = Facts.parse(analyze(join(fixtures, "basic-app")));
  for (const file of old.files) delete file.exportLines;
  assert.equal(code(() => runQuery(old, "definitions", "fetchUser")), "OLD_FACTS");
  assert.equal(code(() => runQuery(old, "importers", "src/lib/user.ts")), "NONE");
});

test("every fixture: each row has a file in the facts and an integer line, and a second run is identical", () => {
  for (const name of readdirSync(fixtures).filter((n) => statSync(join(fixtures, n)).isDirectory())) {
    const f = facts(name);
    const known = new Set(f.files.map((x) => x.path));
    const g = defaultGrouping(f);
    const ask: [string, string][] = [["touches", "database"]];
    for (const file of f.files) {
      ask.push(["importers", file.path]);
      for (const e of file.exports ?? []) ask.push(["definitions", e]);
    }
    for (const e of f.endpoints) ask.push(["definitions", e.name], ["callers", e.name]);
    for (const s of [...f.services, ...f.stores]) ask.push(["touches", s.id]);
    const walk = (ns: typeof g.children): string[] => ns.flatMap((n) => [n.id, ...walk(n.children ?? [])]);
    for (const id of walk(g.children)) ask.push(["files", id]);
    for (const [kind, arg] of ask) {
      const a = runQuery(f, kind, arg, { limit: 500, grouping: g });
      assert.equal(a, runQuery(f, kind, arg, { limit: 500, grouping: g }), `${name} ${kind} ${arg}`);
      for (const row of JSON.parse(a).results) {
        assert.ok(Number.isInteger(row.line) && row.line >= 1, `${name} ${kind} ${arg}: line`);
        assert.ok(known.has(row.file) || kind === "definitions", `${name} ${kind} ${arg}: file ${row.file}`);
      }
    }
  }
});

test("exportLines is aligned with exports and changes nothing the model reads", () => {
  const f = facts("basic-app");
  for (const file of f.files) if (file.exports) assert.equal(file.exportLines?.length, file.exports.length);
  const lines = (path: string, name: string) => {
    const file = f.files.find((x) => x.path === path)!;
    return file.exportLines![file.exports!.indexOf(name)];
  };
  const src = (path: string) => readFileSync(join(fixtures, "basic-app", path), "utf8").split("\n");
  for (const [path, name] of [["src/components/Button.tsx", "Button"], ["src/components/types.ts", "Props"], ["src/lib/cart.ts", "addToCart"], ["src/lib/user.ts", "fetchUser"], ["src/lib/index.ts", "fetchUser"]]) {
    assert.ok(src(path)[lines(path, name) - 1].includes(name), `${path} ${name}`);
  }
  const stripped = Facts.parse(JSON.parse(JSON.stringify(f)));
  for (const file of stripped.files) delete file.exportLines;
  assert.equal(summarize(stripped), summarize(f));
  assert.equal(JSON.stringify(defaultGrouping(stripped)), JSON.stringify(defaultGrouping(f)));
});

test("QUERY_KINDS lists the five kinds", () => assert.equal(QUERY_KINDS.length, 5));
