// What Claude's first grouping tripped on in the /map reliability run (#235): ids it had to guess,
// extensions the digest dropped, hops it couldn't see, and the error messages that follow a miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { chainSection } from "../src/model/chaindigest.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Facts, Grouping } from "../src/model/schema.ts";
import { closest } from "../src/model/story.ts";
import { summarize } from "../src/model/summary.ts";

const stores = analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url)));
const storesGrouping: Grouping = {
  version: 1,
  summary: "",
  children: [
    { id: "web", name: "Web", summary: "", files: ["web/**"] },
    { id: "backend", name: "Backend", summary: "", children: [
      { id: "admin", name: "Admin", summary: "", files: ["functions/**"] },
      { id: "prisma-users", name: "Users", summary: "", files: ["server/src/users.ts"] },
      { id: "supa", name: "Supa", summary: "", files: ["server/src/orders.ts"] },
    ] },
  ],
};

test("digest: service and store ids are listed, a merged service with the store it is drawn as", () => {
  const d = summarize(stores);
  assert.match(d, /- PostgreSQL \(database\) \[svc-postgres, drawn as store-prisma\]: /);
  assert.match(d, /### Database \(Prisma\) \[store-prisma\]/);
  assert.match(d, /### Firestore \[store-firestore\]/);
});

test("story: narratives take store ids and merged service ids; an unknown one gets the closest id", () => {
  const story = {
    actors: [{ id: "shopper", name: "Shopper", summary: "Buys things.", kind: "person" as const }],
    uses: [{ actor: "shopper", part: "web", says: "places orders", entry: "web/src/orders.ts" }],
    narrative: ["A [[shopper]] orders on the [[web]], saved in [[store-firestore]].", "Users live in [[svc-postgres|the user database]].", "Orders go to [[svc-postgresql]]."],
  };
  const g: Grouping = { ...storesGrouping, story };
  const errs = assign(g, stores).errors.join("\n");
  assert.doesNotMatch(errs, /narrative\[[01]\]/);
  assert.match(errs, /narrative\[2\]: unknown reference \[\[svc-postgresql\]\]; did you mean \[\[svc-postgres\]\]\? \(service and store ids: .*store-prisma.*svc-postgres/);
  // the viewer links store boxes; a service merged into its store is drawn as the store
  const ok: Grouping = { ...g, story: { ...story, narrative: story.narrative.slice(0, 2) } };
  const m = buildModel(stores, ok, assign(ok, stores).leafOf);
  assert.deepEqual(m.story!.narrative, [story.narrative[0], "Users live in [[store-prisma|the user database]]."]);
  assert.ok(m.services["store-prisma"] && !m.services["svc-postgres"]);
});

test("closest: a typo or a guessed suffix, but nothing far off", () => {
  assert.equal(closest("svc-postgresql", ["svc-postgres", "svc-stripe", "web"]), "svc-postgres");
  assert.equal(closest("svc-strip", ["svc-postgres", "svc-stripe"]), "svc-stripe");
  assert.equal(closest("billing", ["svc-postgres", "web"]), null);
});

const tiny = (paths: string[], imports: [string, string][] = []): Facts => ({
  repo: "tiny", files: paths.map((path) => ({ path, pkg: "app", loc: 1 })),
  packages: [{ id: "app", name: "app", dir: "", kind: "backend", deps: [] }],
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" })),
  calls: [], services: [], serviceUses: [], endpoints: [], pages: [], stores: [], storeUses: [], storeFields: [],
} as unknown as Facts);

test("digest: only the most common extension is dropped from the file list", () => {
  const d = summarize(tiny(["src/a.ts", "src/b.ts", "src/c.ts", "src/Button.tsx", "env.mjs", "middleware.ts"]));
  assert.match(d, /## Files by folder \(`\.ts` dropped, other extensions shown\)/);
  assert.match(d, /^src\/ \(4\): a, b, c, Button\.tsx$/m);
  assert.match(d, /^\.\/ \(2\): env\.mjs, middleware$/m);
});

test("digest: a root file's folder is '.', not its name cut short", () => {
  const f = tiny(["middleware.ts", "lib/auth.ts"]);
  f.services = [{ id: "auth", name: "Auth provider", category: "auth" }] as Facts["services"];
  f.serviceUses = [{ from: "middleware.ts", service: "auth", spec: "next-auth", line: 1 }, { from: "lib/auth.ts", service: "auth", spec: "next-auth", line: 1 }] as Facts["serviceUses"];
  assert.match(summarize(f), /- Auth provider \[svc-auth\]: \. \(1\), lib \(1\)/);
});

test("grouping: an explicit path with the wrong extension is named in the uncovered-files error", () => {
  const f = tiny(["src/a.ts", "src/Button.tsx"]);
  const g: Grouping = { version: 1, summary: "", children: [
    { id: "x", name: "X", summary: "", files: ["src/a.ts"] },
    { id: "y", name: "Y", summary: "", files: ["src/Button.ts"] },
  ] };
  assert.match(assign(g, f).errors.join("\n"), /src\/Button\.tsx \(pattern "src\/Button\.ts" in "y" has the wrong extension\)/);
});

test("chains: distinct flows into a shared client each keep a chain; next hops list the real imports", () => {
  const f = tiny(
    ["src/auth/auth.controller.ts", "src/auth/auth.service.ts", "src/profile/profile.controller.ts", "src/profile/profile.service.ts", "src/profile/profile.utils.ts", "src/db/client.ts"],
    [["src/auth/auth.controller.ts", "src/auth/auth.service.ts"], ["src/auth/auth.service.ts", "src/db/client.ts"], ["src/profile/profile.controller.ts", "src/profile/profile.service.ts"], ["src/profile/profile.service.ts", "src/db/client.ts"], ["src/profile/profile.service.ts", "src/profile/profile.utils.ts"]],
  );
  f.endpoints = [{ name: "/user", kind: "http", file: "src/auth/auth.controller.ts", line: 1 }, { name: "/profiles", kind: "http", file: "src/profile/profile.controller.ts", line: 1 }] as Facts["endpoints"];
  f.stores = [{ id: "prisma", name: "Database (Prisma)" }] as Facts["stores"];
  f.storeUses = [{ store: "prisma", collection: "user", op: "read", file: "src/db/client.ts", line: 1 }] as Facts["storeUses"];
  const lines = chainSection(f, 10, 5).join("\n");
  assert.match(lines, /^- src\/auth\/auth\.controller\.ts → src\/auth\/auth\.service\.ts → src\/db\/client\.ts {2}\[store-prisma: user \(r\)\]$/m);
  assert.match(lines, /^- src\/profile\/profile\.controller\.ts → src\/profile\/profile\.service\.ts → src\/db\/client\.ts/m);
  // same-folder targets by name, others by path
  assert.match(lines, /^ {2}src\/profile\/profile\.service\.ts → src\/db\/client\.ts, profile\.utils\.ts$/m);
});

test("grouping (default) still validates against its own digest's facts", () => {
  const f = tiny(["src/a.ts", "src/b.tsx"]);
  assert.deepEqual(assign(defaultGrouping(f), f).errors, []);
});
