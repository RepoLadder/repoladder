// Prisma 7 (#253): the client is generated into the repo (`@/generated/prisma/client`) and connects
// through a driver adapter (`@prisma/adapter-pg`), so there is no `@prisma/client` import to go by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { serviceFor } from "../src/analyze/services.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, mergedServices } from "../src/model/rollup.ts";
import type { Facts } from "../src/model/schema.ts";
import { summarize } from "../src/model/summary.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/prisma7", import.meta.url)));
const uses = (f: Facts) => f.storeUses.map((u) => `${u.store} ${u.collection} ${u.op} ${u.file}:${u.line}`);
const fields = (f: Facts) => f.storeFields.map((x) => `${x.collection}.${x.field} ${x.how} ${x.file}:${x.line}`);

/** A throwaway repo: package.json with these dependencies, plus the given source files. */
function repo(deps: string[], files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-prisma7-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: Object.fromEntries(deps.map((d) => [d, "1.0.0"])) }));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}
const SCHEMA = "datasource db {\n  provider = \"postgresql\"\n}\n\nmodel User {\n  id String @id\n}\n";

test("prisma7: a generated client and a driver adapter give the Prisma store, its uses and the schema's fields", () => {
  assert.deepEqual(facts.stores.map((s) => s.id), ["prisma"]);
  assert.deepEqual(uses(facts), [
    "prisma website read src/queries/website.ts:4",
    "prisma session write src/queries/website.ts:8",
  ]);
  assert.deepEqual(fields(facts), [
    "session. declared prisma/schema.prisma:16",
    "session.id declared prisma/schema.prisma:17",
    "session.websiteId declared prisma/schema.prisma:18",
    "session.websiteId write src/queries/website.ts:8",
    "website. declared prisma/schema.prisma:10",
    "website.domain declared prisma/schema.prisma:13",
    "website.id declared prisma/schema.prisma:11",
    "website.name declared prisma/schema.prisma:12",
    "website.name query src/queries/website.ts:4",
  ]);
  // the gate doesn't depend on resolving the generated client
  assert.ok(facts.unresolved.some((u) => u.spec === "@/generated/prisma/client" && u.from === "src/lib/prisma.ts"));
});

test("prisma7: the pg adapter is PostgreSQL, drawn as the Prisma store", () => {
  assert.ok(facts.services.some((s) => s.id === "postgres"));
  assert.deepEqual(facts.serviceUses.map((u) => `${u.from}:${u.line} ${u.service}`), ["src/lib/prisma.ts:1 postgres"]);
  assert.equal(mergedServices(facts).get("postgres"), "prisma");
  const d = summarize(facts);
  assert.match(d, /- PostgreSQL \(database\) \[svc-postgres, drawn as store-prisma\]: /);
  assert.match(d, /### Database \(Prisma\) \[store-prisma\]/);
  const g = defaultGrouping(facts);
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  assert.ok(model.services["store-prisma"]);
  assert.equal(model.services["svc-postgres"], undefined);
});

test("prisma7 gate: an adapter import alone turns Prisma on; a SQLite adapter is drawn as the store", () => {
  const f = analyze(repo(["@prisma/adapter-better-sqlite3"], {
    "src/db.ts": 'import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";\ndeclare const prisma: any;\nexport const all = () => prisma.user.findMany();\n',
  }));
  assert.deepEqual(f.stores.map((s) => s.id), ["prisma"]);
  assert.deepEqual(uses(f), ["prisma user read src/db.ts:3"]);
  assert.match(summarize(f), /\[svc-sqlite, drawn as store-prisma\]/);
});

test("prisma7 gate: a schema file alone turns Prisma on", () => {
  const f = analyze(repo([], {
    "prisma/schema.prisma": SCHEMA,
    "src/db.ts": "declare const db: any;\nexport const add = () => db.user.create({ data: {} });\n",
  }));
  assert.deepEqual(f.stores.map((s) => s.id), ["prisma"]);
  assert.deepEqual(uses(f), ["prisma user write src/db.ts:2"]);
});

test("prisma7 gate: an extension import alone turns Prisma on and draws no service", () => {
  const f = analyze(repo(["@prisma/extension-accelerate"], {
    "src/db.ts": 'import { withAccelerate } from "@prisma/extension-accelerate";\ndeclare const prisma: any;\nexport const n = () => prisma.user.count();\n',
  }));
  assert.deepEqual(f.stores.map((s) => s.id), ["prisma"]);
  assert.deepEqual(f.serviceUses, []);
});

test("prisma7 gate: a schema with no queries gives no store; no Prisma signal gives no store", () => {
  const schemaOnly = analyze(repo([], { "prisma/schema.prisma": SCHEMA, "src/index.ts": "export const x = 1;\n" }));
  assert.deepEqual(schemaOnly.stores, []);
  assert.deepEqual(schemaOnly.storeFields, []);
  const none = analyze(repo([], { "src/db.ts": "declare const db: any;\nexport const all = () => db.user.findMany();\n" }));
  assert.deepEqual(none.stores, []);
});

test("serviceFor: each Prisma adapter is its database; mssql and extensions draw nothing", () => {
  const id = (s: string) => serviceFor(s)?.id ?? null;
  for (const s of ["adapter-pg", "adapter-neon", "adapter-pg-worker"]) assert.equal(id(`@prisma/${s}`), "postgres", s);
  for (const s of ["adapter-planetscale", "adapter-mariadb"]) assert.equal(id(`@prisma/${s}`), "mysql", s);
  for (const s of ["adapter-libsql", "adapter-better-sqlite3", "adapter-d1"]) assert.equal(id(`@prisma/${s}`), "sqlite", s);
  for (const s of ["adapter-mssql", "extension-accelerate", "extension-optimize"]) assert.equal(id(`@prisma/${s}`), null, s);
  assert.equal(id("@prisma/client"), "postgres");
});
