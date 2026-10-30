import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { isSourcePath } from "../src/analyze/files.ts";
import { Facts } from "../src/model/schema.ts";
import { endpointLabel } from "../src/model/endpoints.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const edges = (f: Facts) => f.imports.map((i) => `${i.from} -> ${i.to} [${i.kind}${i.via ? ` via ${i.via}` : ""}]`);

test("basic-app: files, exclusions and package", () => {
  const f = Facts.parse(analyze(fixture("basic-app")));
  assert.deepEqual(f.files.map((x) => x.path), [
    "src/components/Button.tsx",
    "src/components/types.ts",
    "src/legacy.js",
    "src/lib/cart.ts",
    "src/lib/index.ts",
    "src/lib/user.ts",
    "src/main.tsx",
    "src/pages/Home.tsx",
  ]);
  assert.deepEqual(f.packages.map((p) => [p.id, p.kind]), [["basic-app", "web"]]);
});

test("src/build is source; build output folders elsewhere are not", () => {
  assert.ok(isSourcePath("src/build/layout.ts"));
  assert.ok(isSourcePath("src/build/engines/elk.ts"));
  assert.ok(!isSourcePath("build/index.js"));
  assert.ok(!isSourcePath("packages/web/build/main.js"));
  assert.ok(!isSourcePath("src/dist/x.js"));
});

test("basic-app: aliases, barrels, lazy, require and type imports", () => {
  const e = edges(analyze(fixture("basic-app")));
  assert.deepEqual(e, [
    "src/components/Button.tsx -> src/lib/cart.ts [static via src/lib/index.ts]",
    "src/components/Button.tsx -> src/lib/user.ts [static via src/lib/index.ts]",
    "src/components/Button.tsx -> src/components/types.ts [type]",
    "src/legacy.js -> src/lib/user.ts [require]",
    "src/lib/index.ts -> src/lib/user.ts [reexport]",
    "src/lib/index.ts -> src/lib/cart.ts [reexport]",
    "src/main.tsx -> src/lib/user.ts [static via src/lib/index.ts]",
    "src/main.tsx -> src/pages/Home.tsx [lazy]",
    "src/pages/Home.tsx -> src/components/Button.tsx [static]",
    // namespace import can't be traced through the barrel
    "src/pages/Home.tsx -> src/lib/index.ts [static]",
  ]);
});

test("basic-app: externals and unresolved", () => {
  const f = analyze(fixture("basic-app"));
  assert.deepEqual(f.externals.map((x) => `${x.from} ${x.spec}`), [
    "src/lib/cart.ts stripe",
    "src/lib/user.ts node:fs",
    "src/main.tsx react-dom",
  ]);
  // styles.css is an asset and skipped; ./nope is a real broken import
  assert.deepEqual(f.unresolved.map((x) => `${x.from} ${x.spec}`), ["src/pages/Home.tsx ./nope"]);
});

test("multi: sub-packages and root script folders", () => {
  const f = analyze(fixture("multi"));
  assert.deepEqual(
    f.packages.map((p) => [p.id, p.kind, p.dir]),
    [
      ["multi-root", "library", ""],
      ["functions", "backend", "functions"],
      ["tools", "scripts", "tools"],
      ["web", "web", "web"],
    ],
  );
  assert.deepEqual(f.files.map((x) => `${x.pkg}:${x.path}`), [
    "functions:functions/src/index.ts",
    "functions:functions/src/server.ts",
    "multi-root:setup.mjs",
    "tools:tools/seed.cjs",
    "web:web/src/api.ts",
    "web:web/src/main.ts",
  ]);
});

test("output is deterministic", () => {
  assert.equal(JSON.stringify(analyze(fixture("basic-app"))), JSON.stringify(analyze(fixture("basic-app"))));
});

test("multi: services, endpoints and call edges", () => {
  const f = analyze(fixture("multi"));
  assert.deepEqual(f.services.map((s) => s.id), ["firebase-auth", "stripe"]);
  assert.deepEqual(f.endpoints.map((e) => `${e.file} ${e.name} ${e.kind}`), [
    "functions/src/index.ts ping callable",
    "functions/src/index.ts pingHttp http",
    "functions/src/index.ts nightly event",
    "functions/src/index.ts api http",
    "functions/src/server.ts /users/:id http",
  ]);
  assert.deepEqual(f.calls.map((c) => `${c.from}:${c.line} -> ${c.endpoint} ${c.kind}`), [
    "web/src/api.ts:4 -> ping callable",
    "web/src/api.ts:5 -> pingHttp http",
    "web/src/api.ts:6 -> /users/:id http",
  ]);
});

const routesOf = (name: string) => {
  const f = analyze(fixture(`servers/${name}`));
  return {
    endpoints: f.endpoints.map((e) => `${e.file}:${e.line} ${endpointLabel(e)} ${e.kind}`),
    calls: f.calls.map((c) => `${c.from}:${c.line} -> ${c.endpoint} ${c.kind}`),
  };
};

test("express: routers mounted across files (ESM and CommonJS), app.route chains", () => {
  assert.deepEqual(routesOf("express"), {
    endpoints: [
      "src/health.js:2 GET /health/live http",
      // users.get("/") is reachable through its mount; the bare root route on app is dropped
      "src/routes/users.ts:3 GET /api/users http",
      "src/routes/users.ts:4 GET /api/users/:id http",
      // a same-line chain (.put().delete()) is one endpoint answering both (#244)
      "src/routes/users.ts:5 PUT, DELETE /api/users/:id/avatar http",
    ],
    calls: [
      "src/client.ts:1 -> /api/users/:id http",
      "src/client.ts:2 -> /api/users/:id/avatar http",
      "src/client.ts:3 -> /health/live http",
    ],
  });
});

test("hono: basePath, chained methods and app.route mounts", () => {
  assert.deepEqual(routesOf("hono"), {
    endpoints: [
      "src/books.ts:3 POST /api/books/:id/borrow http",
      "src/books.ts:3 GET /api/books http",
      "src/index.ts:4 GET /api/ping http",
    ],
    calls: ["src/client.ts:1 -> /api/books/:id/borrow http"],
  });
});

test("hono openapi: createRoute definitions joined to the router they are .openapi()-ed on (#233)", () => {
  assert.deepEqual(routesOf("hono-openapi"), {
    endpoints: [
      // tasks, health and notes are reached through loop mounts (forEach, map, for…of) over same-file arrays (#244)
      // a local createRoute on an identifier router, mounted under an exported alias
      "src/routes/health.ts:5 GET /api/health/ping http",
      // inline createRoute on a factory chain that is the default export
      "src/routes/health.ts:6 GET /api/health/live http",
      // namespace import (routes.list) and a renamed named import (hidden), on `const router = createRouter().openapi(...)`
      // a for…of over a same-file array, with a non-root prefix, under the app's basePath (#244)
      "src/routes/notes.ts:4 GET /api/v2/notes http",
      "src/routes/tasks/tasks.index.ts:6 GET /api/tasks http",
      "src/routes/tasks/tasks.index.ts:7 POST /api/tasks http",
      "src/routes/tasks/tasks.index.ts:8 GET /api/tasks/{id} http",
      "src/routes/tasks/tasks.index.ts:9 GET /api/internal http",
    ],
    // the createRoute path literals are definitions, not client calls; `{id}` takes a value
    calls: [
      "src/client.ts:1 -> /api/tasks/{id} http",
      "src/client.ts:2 -> /api/tasks http",
    ],
  });
});

test("koa-router: constructor prefix, named routes and nested router.use", () => {
  assert.deepEqual(routesOf("koa"), {
    endpoints: ["src/admin.ts:3 GET /v1/admin/users/:id http", "src/server.ts:6 GET /v1/status http"],
    calls: ["src/client.ts:1 -> /v1/admin/users/:id http"],
  });
});

test("fastify: plugins registered with prefixes, route({ url }), no call edges from prefix literals", () => {
  assert.deepEqual(routesOf("fastify"), {
    endpoints: [
      "src/admin.ts:4 GET, HEAD /admin/stats http",
      "src/server.ts:6 GET /v2/ping http",
      "src/server.ts:7 GET /status http",
      "src/users.ts:3 GET /users/:id http",
      "src/users.ts:4 POST /users http",
    ],
    calls: ["src/client.ts:1 -> /admin/stats http", "src/client.ts:2 -> /v2/ping http"],
  });
});

test("nest: controller and method decorators with the global prefix", () => {
  assert.deepEqual(routesOf("nest"), {
    endpoints: [
      "src/users/users.controller.ts:5 GET /api/users http",
      "src/users/users.controller.ts:8 GET /api/users/:id http",
      "src/users/users.controller.ts:11 POST /api/users/:id/ban http",
      "src/users/users.controller.ts:11 POST /api/users/:id/block http",
      "src/users/users.controller.ts:19 GET /api/health/live http",
    ],
    calls: ["src/client.ts:1 -> /api/users/:id/ban http"],
  });
});

test("trpc: nested router procedures and exact-path client calls", () => {
  assert.deepEqual(routesOf("trpc"), {
    endpoints: [
      "src/server/root.ts:6 health.ping callable",
      "src/server/routers/user.ts:4 user.byId callable",
      "src/server/routers/user.ts:5 user.create callable",
    ],
    // trpc.user.nope has no procedure, so no edge
    calls: [
      "src/web/page.tsx:3 -> user.byId callable",
      "src/web/page.tsx:4 -> user.create callable",
      "src/web/page.tsx:8 -> health.ping callable",
    ],
  });
});

test("digest lists endpoints with their methods; entry points stay bare paths (#244)", async () => {
  const { summarize, entryPoints } = await import("../src/model/summary.ts");
  const facts = analyze(fixture("servers/hono-openapi"));
  assert.match(summarize(facts), /tasks\.index(\.ts)?: GET \/api\/tasks, POST \/api\/tasks, GET \/api\/tasks\/\{id\}, GET \/api\/internal/);
  const http = entryPoints(facts).find((l) => l.includes("/api/tasks"));
  assert.ok(http, "an entry-points line lists /api/tasks");
  assert.ok(!http.includes("GET "), http);
});

test("facts cached before #244 (no methods) still parse and label by bare name", () => {
  const facts = JSON.parse(JSON.stringify(analyze(fixture("servers/hono-openapi"))));
  for (const e of facts.endpoints) delete e.methods;
  const parsed = Facts.parse(facts);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.endpoints.map(endpointLabel).slice(0, 2), ["/api/health/ping", "/api/health/live"]);
});

test("loops over anything but a same-file array literal mount nothing new (#244)", async () => {
  const ts = (await import("typescript")).default;
  const { scanRoutes } = await import("../src/analyze/routes.ts");
  const src = [
    'import { list } from "./list";',
    "const app = new Hono();",
    "list.forEach((r) => app.route(\"/x\", r));",
    "getRoutes().forEach((r) => app.route(\"/y\", r));",
    "for (const r of [a, ...more]) app.route(\"/z\", r);",
  ].join("\n");
  const sf = ts.createSourceFile("app.ts", src, ts.ScriptTarget.Latest, true);
  const out = scanRoutes(ts, sf, (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
  // the first two keep today's single mount of the loop variable; the literal mounts its non-spread element
  assert.deepEqual(out.mounts.map((m) => `${m.prefix} ${JSON.stringify(m.child)}`), ['/x {"local":"r"}', '/y {"local":"r"}', '/z {"local":"a"}']);
});

test("catch-all routes (.all, @All) carry no method; stated ones do (#244)", async () => {
  const ts = (await import("typescript")).default;
  const { scanRoutes } = await import("../src/analyze/routes.ts");
  const scan = (src: string) => {
    const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
    return scanRoutes(ts, sf, (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1).routes.map((r) => `${r.path} ${r.methods?.join(",") ?? "-"}`);
  };
  assert.deepEqual(scan('const app = express();\napp.all("/any", h);\napp.patch("/p", h);'), ["/any -", "/p PATCH"]);
  assert.deepEqual(scan('@Controller("c")\nclass C {\n  @All("a") a() {}\n  @Put("b") b() {}\n}'), ["/c/a -", "/c/b PUT"]);
});

test("built-in property names are not mistaken for function triggers", async () => {
  const { parseFile } = await import("../src/analyze/resolve.ts");
  const pf = parseFile("x.ts", "export const a = constructor(); export const b = toString(); export const c = onCall(() => 1);");
  assert.deepEqual(pf.endpoints.map((e) => e.name), ["c"]);
});

test("described: package description and folder READMEs are recorded as hints", () => {
  const f = analyze(fileURLToPath(new URL("./fixtures/described", import.meta.url)));
  assert.equal(f.packages.find((p) => p.name === "@described/core")!.description, "Shared money and date helpers for the apps");
  assert.equal(f.packages.find((p) => p.name === "web")!.description, undefined);
  const auth = f.readmes!.find((r) => r.dir === "apps/web/src/auth")!;
  assert.equal(auth.title, "Auth");
  assert.equal(auth.text, "Sign-in and session handling for the web app.");
  assert.match(f.readmes!.find((r) => r.dir === "apps/web")!.text!, /bootstrapped with/);
  assert.doesNotThrow(() => Facts.parse(f));
});

test("basic-app: no README and no description add no keys", () => {
  const f = analyze(fileURLToPath(new URL("./fixtures/basic-app", import.meta.url)));
  assert.ok(!("readmes" in f));
  for (const p of f.packages) assert.ok(!("description" in p));
});
